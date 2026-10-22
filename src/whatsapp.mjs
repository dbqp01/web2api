import { z } from 'zod';
import { existsSync } from 'node:fs';
import { readFile, writeFile, rename, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';
import { makeWASocket, useMultiFileAuthState, DisconnectReason, Browsers } from '@whiskeysockets/baileys';
import { WorkflowError } from './contracts.mjs';
import { createStore } from './whatsapp-store.mjs';

const noop = () => {};
const silentLogger = { level: 'silent', child: () => silentLogger, trace: noop, debug: noop, info: noop, warn: noop, error: noop, fatal: noop };

const limits = [
  'Read-only bridge to the user\'s own paired WhatsApp account; it never sends messages or presence updates and does not request read receipts.',
  'Unofficial multi-device client: use is at the user\'s risk and may violate WhatsApp Terms; account restriction is possible.',
  'In-memory snapshot from the recent history sync and live events; it is not a complete archive and resets on restart.',
  'Media is not downloaded; only type, caption/text and timestamps are exposed.',
  'Edits and deletions are not merged into the stored message; reactions are stored as their own messages.',
  'The protocol may still emit automatic delivery acknowledgements; this app does not send read receipts.',
];

const evidence = z.object({
  source_mode: z.literal('observed_first_party_protocol'),
  scope: z.literal('whatsapp_personal_read_only'),
  transport: z.literal('whatsapp_multidevice_websocket'),
  session: z.literal('user_paired_device'),
  observed_at: z.iso.datetime(),
  connected: z.boolean(),
  history_synced: z.boolean(),
  limits: z.array(z.string()).min(1),
}).strict();
const output = data => z.object({ data, evidence }).strict();

const message = z.object({
  id: z.string().min(1).max(200),
  chat_id: z.string().min(1).max(200),
  sender_jid: z.string().min(1).max(200).nullable(),
  from_me: z.boolean(),
  timestamp: z.iso.datetime(),
  type: z.string().min(1).max(80),
  text: z.string().max(4000).nullable(),
  has_media: z.boolean(),
}).strict();

const chat = z.object({
  id: z.string().min(1).max(200),
  name: z.string().min(1).max(500),
  is_group: z.boolean(),
  unread_count: z.number().int().nonnegative(),
  archived: z.boolean(),
  last_message_at: z.iso.datetime().nullable(),
  last_message_preview: z.string().max(120).nullable(),
}).strict();

const status = z.object({
  state: z.enum(['awaiting_pairing', 'connecting', 'connected', 'logged_out', 'error']),
  connected: z.boolean(),
  self_jid: z.string().max(200).nullable(),
  history_synced: z.boolean(),
  chat_count: z.number().int().nonnegative(),
  message_count: z.number().int().nonnegative(),
  oldest_message_at: z.iso.datetime().nullable(),
  newest_message_at: z.iso.datetime().nullable(),
  last_error: z.string().max(200).nullable(),
}).strict();

const limit = z.number().int().min(1).max(200).default(50);

export const whatsappInputs = {
  whatsapp_status: z.object({}).strict(),
  whatsapp_list_chats: z.object({ limit }).strict(),
  whatsapp_get_messages: z.object({ chat_id: z.string().min(1).max(200), limit }).strict(),
  whatsapp_search_messages: z.object({ query: z.string().trim().min(1).max(200), chat_id: z.string().min(1).max(200).optional(), limit }).strict(),
};

export const whatsappOutputs = {
  whatsapp_status: output(status),
  whatsapp_list_chats: output(z.object({ chats: z.array(chat).max(200), total: z.number().int().nonnegative(), truncated: z.boolean() }).strict()),
  whatsapp_get_messages: output(z.object({ chat_id: z.string().max(200), messages: z.array(message).max(200), total: z.number().int().nonnegative(), truncated: z.boolean() }).strict()),
  whatsapp_search_messages: output(z.object({ matches: z.array(message.extend({ chat_name: z.string().max(500) })).max(200), scanned: z.number().int().nonnegative(), total: z.number().int().nonnegative(), truncated: z.boolean() }).strict()),
};

export const whatsappDefinitions = {
  whatsapp_status: { input: whatsappInputs.whatsapp_status, output: whatsappOutputs.whatsapp_status, effect: 'read', auth: 'user_session',
    description: 'Estado de la vinculación de WhatsApp y tamaño de la instantánea en memoria (chats y mensajes). Solo lectura.' },
  whatsapp_list_chats: { input: whatsappInputs.whatsapp_list_chats, output: whatsappOutputs.whatsapp_list_chats, effect: 'read', auth: 'user_session',
    description: 'Lista chats de WhatsApp ordenados por actividad reciente: nombre, grupo, no leídos, último mensaje. Solo lectura.' },
  whatsapp_get_messages: { input: whatsappInputs.whatsapp_get_messages, output: whatsappOutputs.whatsapp_get_messages, effect: 'read', auth: 'user_session',
    description: 'Devuelve los mensajes más recientes de un chat en orden cronológico. No descarga multimedia ni envía mensajes.' },
  whatsapp_search_messages: { input: whatsappInputs.whatsapp_search_messages, output: whatsappOutputs.whatsapp_search_messages, effect: 'read', auth: 'user_session',
    description: 'Busca texto (sin distinguir mayúsculas) en los mensajes sincronizados, opcionalmente dentro de un chat. Solo lectura.' },
};

export function resolveWhatsAppAuthDir(explicit) {
  if (explicit) return explicit;
  if (process.env.WEB2API_WHATSAPP_AUTH) return process.env.WEB2API_WHATSAPP_AUTH;
  const local = join(process.cwd(), '.local');
  if (existsSync(local)) return join(local, 'whatsapp-auth');
  return join(process.env.LOCALAPPDATA || join(homedir(), '.local/share'), 'Web2API', 'whatsapp-auth');
}

export function whatsappAuthAvailable(dir = resolveWhatsAppAuthDir()) {
  return existsSync(join(dir, 'creds.json'));
}

export function createWhatsAppRunner({ authDir = resolveWhatsAppAuthDir(), pair = false, onQr } = {}) {
  const store = createStore();
  const storePath = join(authDir, 'store.json');
  let socket = null;
  let state = whatsappAuthAvailable(authDir) ? 'connecting' : 'awaiting_pairing';
  let selfJid = null;
  let historySynced = false;
  let lastError = null;
  let reconnectTimer = null;
  let saveTimer = null;
  let dirty = false;
  let loaded = false;
  let started = false;
  let closed = false;
  let attempts = 0;

  const setState = (next, error = null) => {
    state = next;
    lastError = error ? String(error).slice(0, 200) : null;
  };

  const save = async () => {
    if (!dirty) return;
    dirty = false;
    try {
      await mkdir(dirname(storePath), { recursive: true });
      await writeFile(`${storePath}.tmp`, JSON.stringify(store.toJSON()));
      await rename(`${storePath}.tmp`, storePath);
    } catch {
      dirty = true;
    }
  };

  const scheduleSave = () => {
    dirty = true;
    if (saveTimer) return;
    saveTimer = setTimeout(() => { saveTimer = null; save(); }, 1000);
    saveTimer.unref?.();
  };

  const schedule = milliseconds => {
    if (closed || reconnectTimer) return;
    reconnectTimer = setTimeout(() => { reconnectTimer = null; connect(); }, milliseconds);
    reconnectTimer.unref?.();
  };

  async function connect() {
    if (closed) return;
    try {
      const { state: auth, saveCreds } = await useMultiFileAuthState(authDir);
      const sock = makeWASocket({
        auth,
        logger: silentLogger,
        printQRInTerminal: false,
        markOnlineOnConnect: false,
        syncFullHistory: false,
        shouldSyncHistoryMessage: () => true,
        emitOwnEvents: false,
        browser: Browsers.ubuntu('Chrome'),
      });
      socket = sock;
      sock.ev.on('creds.update', saveCreds);
      sock.ev.on('connection.update', update => {
        if (socket !== sock) return;
        if (update.qr && onQr) onQr(update.qr);
        if (update.connection === 'open') {
          attempts = 0;
          selfJid = sock.user?.id ?? null;
          setState('connected');
        } else if (update.connection === 'close') {
          if (closed) return;
          const code = update.lastDisconnect?.error?.output?.statusCode;
          const reason = update.lastDisconnect?.error?.message;
          socket = null;
          if (code === DisconnectReason.loggedOut) {
            setState('logged_out', reason);
            return;
          }
          setState('connecting', reason);
          attempts++;
          schedule(code === DisconnectReason.restartRequired ? 0 : Math.min(1000 * 2 ** attempts, 30_000));
        }
      });
      sock.ev.on('messaging-history.set', ({ chats, contacts, messages, isLatest }) => {
        store.upsertContacts(contacts);
        store.upsertChats(chats);
        store.addMessages(messages);
        if (isLatest) historySynced = true;
        scheduleSave();
      });
      sock.ev.on('chats.upsert', list => { store.upsertChats(list); scheduleSave(); });
      sock.ev.on('chats.update', list => { store.upsertChats(list); scheduleSave(); });
      sock.ev.on('contacts.upsert', list => { store.upsertContacts(list); scheduleSave(); });
      sock.ev.on('contacts.update', list => { store.upsertContacts(list); scheduleSave(); });
      sock.ev.on('messages.upsert', ({ messages }) => { store.addMessages(messages); scheduleSave(); });
    } catch (error) {
      socket = null;
      setState('error', error?.message);
      attempts++;
      schedule(Math.min(1000 * 2 ** attempts, 30_000));
    }
  }

  return {
    async start() {
      if (started) return;
      started = true;
      if (!whatsappAuthAvailable(authDir) && !pair) {
        setState('awaiting_pairing');
        return;
      }
      if (!loaded) {
        loaded = true;
        try {
          store.hydrate(JSON.parse(await readFile(storePath, 'utf8')));
          historySynced = store.counts().message_count > 0;
        } catch {}
      }
      await connect();
      const deadline = Date.now() + 10_000;
      while (!closed && state === 'connecting' && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 200));
    },
    async close() {
      closed = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (saveTimer) clearTimeout(saveTimer);
      reconnectTimer = null;
      saveTimer = null;
      await save();
      try { socket?.end(undefined); } catch {}
      socket = null;
    },
    async run(tool, input) {
      const counts = store.counts();
      const current = {
        state,
        connected: state === 'connected',
        self_jid: selfJid,
        history_synced: historySynced,
        ...counts,
        last_error: lastError,
      };
      const stamp = {
        source_mode: 'observed_first_party_protocol',
        scope: 'whatsapp_personal_read_only',
        transport: 'whatsapp_multidevice_websocket',
        session: 'user_paired_device',
        observed_at: new Date().toISOString(),
        connected: state === 'connected',
        history_synced: historySynced,
        limits,
      };
      if (tool === 'whatsapp_status') return { data: current, evidence: stamp };
      if (state === 'awaiting_pairing') throw new WorkflowError('SESSION_NOT_CONFIGURED', 401);
      if (state === 'logged_out') throw new WorkflowError('REAUTH_REQUIRED', 401);
      if (state !== 'connected') throw new WorkflowError('SESSION_NOT_READY', 503);
      if (tool === 'whatsapp_list_chats') return { data: store.listChats(input.limit), evidence: stamp };
      if (tool === 'whatsapp_get_messages') return { data: { chat_id: input.chat_id, ...store.messagesFor(input.chat_id, input.limit) }, evidence: stamp };
      if (tool === 'whatsapp_search_messages') return { data: store.search(input.query, input.chat_id, input.limit), evidence: stamp };
      throw new WorkflowError('UNSUPPORTED_OPERATION');
    },
  };
}
