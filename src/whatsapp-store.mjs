const MAX_CHATS = 1000;
const MAX_MESSAGES_PER_CHAT = 200;
const MAX_TEXT = 4000;
const ignoredTypes = new Set(['messageContextInfo', 'senderKeyDistributionMessage', 'protocolMessage']);
const mediaTypes = new Set(['imageMessage', 'videoMessage', 'audioMessage', 'documentMessage', 'stickerMessage', 'ptvMessage']);
const wrappers = new Set(['ephemeralMessage', 'viewOnceMessage', 'viewOnceMessageV2', 'viewOnceMessageV2Extension', 'documentWithCaptionMessage', 'deviceSentMessage']);

function unwrap(message) {
  let content = message;
  for (let depth = 0; depth < 3; depth++) {
    const key = Object.keys(content).find(name => wrappers.has(name));
    if (!key) break;
    const inner = content[key]?.message;
    if (!inner) return null;
    content = inner;
  }
  return content;
}

function secondsToMillis(value) {
  let number;
  if (typeof value === 'number') number = value;
  else if (typeof value === 'bigint') number = Number(value);
  else if (value && typeof value.toNumber === 'function') number = value.toNumber();
  else number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return null;
  return number < 1e12 ? number * 1000 : number;
}

function contentText(content, type) {
  switch (type) {
    case 'conversation': return content.conversation ?? null;
    case 'extendedTextMessage': return content.extendedTextMessage?.text ?? null;
    case 'imageMessage':
    case 'videoMessage':
    case 'documentMessage': return content[type]?.caption ?? null;
    case 'buttonsResponseMessage': return content.buttonsResponseMessage?.selectedDisplayText ?? null;
    case 'listResponseMessage': return content.listResponseMessage?.title ?? null;
    case 'templateButtonReplyMessage': return content.templateButtonReplyMessage?.selectedDisplayText ?? null;
    case 'reactionMessage': return content.reactionMessage?.text ?? null;
    case 'pollCreationMessage':
    case 'pollCreationMessageV2':
    case 'pollCreationMessageV3': return content[type]?.name ?? null;
    case 'locationMessage': return content.locationMessage?.name ?? null;
    default: return null;
  }
}

export function normalizeMessage(raw) {
  if (!raw?.key?.id || !raw.key.remoteJid || !raw.message) return null;
  const content = unwrap(raw.message);
  if (!content) return null;
  const type = Object.keys(content).find(key => !ignoredTypes.has(key));
  if (!type) return null;
  const millis = secondsToMillis(raw.messageTimestamp);
  if (!millis) return null;
  const text = contentText(content, type);
  return {
    id: raw.key.id,
    chat_id: raw.key.remoteJid,
    sender_jid: raw.key.participant ?? (raw.key.fromMe ? null : raw.key.remoteJid),
    from_me: Boolean(raw.key.fromMe),
    timestamp: new Date(millis).toISOString(),
    type,
    text: typeof text === 'string' ? text.trim().slice(0, MAX_TEXT) || null : null,
    has_media: mediaTypes.has(type),
  };
}

const timeOf = message => Date.parse(message.timestamp);
const preview = message => message.text ? message.text.slice(0, 120) : `[${message.type}]`;

export function createStore({ maxChats = MAX_CHATS, maxMessagesPerChat = MAX_MESSAGES_PER_CHAT } = {}) {
  const chats = new Map();
  const messages = new Map();
  const contacts = new Map();

  const nameOf = id => {
    const chat = chats.get(id);
    const contact = contacts.get(id);
    return chat?.name || chat?.subject || contact?.name || contact?.notify || contact?.verifiedName || id;
  };

  const latest = bucket => {
    let found = null;
    for (const message of bucket.values()) if (!found || timeOf(message) > timeOf(found)) found = message;
    return found;
  };

  const trim = (bucket, remove) => {
    const oldest = [...bucket.values()].sort((a, b) => timeOf(a) - timeOf(b)).slice(0, remove);
    for (const message of oldest) bucket.delete(message.id);
  };

  const evict = () => {
    const oldest = [...chats.values()].sort((a, b) => (secondsToMillis(a.conversationTimestamp) ?? 0) - (secondsToMillis(b.conversationTimestamp) ?? 0))[0];
    if (!oldest) return;
    chats.delete(oldest.id);
    messages.delete(oldest.id);
  };

  const put = message => {
    let bucket = messages.get(message.chat_id);
    if (!bucket) messages.set(message.chat_id, bucket = new Map());
    const added = !bucket.has(message.id);
    bucket.set(message.id, message);
    if (!chats.has(message.chat_id)) chats.set(message.chat_id, { id: message.chat_id });
    const chat = chats.get(message.chat_id);
    if (timeOf(message) > (secondsToMillis(chat.conversationTimestamp) ?? 0)) chat.conversationTimestamp = Math.floor(timeOf(message) / 1000);
    return added;
  };

  const trimTouched = touched => {
    for (const id of touched) {
      const bucket = messages.get(id);
      if (bucket.size > maxMessagesPerChat) trim(bucket, bucket.size - maxMessagesPerChat);
    }
    while (chats.size > maxChats) evict();
  };

  return {
    upsertChats(list) {
      for (const item of list ?? []) {
        if (!item?.id) continue;
        chats.set(item.id, { ...(chats.get(item.id) ?? {}), ...item });
        while (chats.size > maxChats) evict();
      }
    },
    upsertContacts(list) {
      for (const item of list ?? []) {
        if (!item?.id) continue;
        contacts.set(item.id, { ...(contacts.get(item.id) ?? {}), ...item });
      }
    },
    addMessages(list) {
      const touched = new Set();
      let added = 0;
      for (const raw of list ?? []) {
        const message = normalizeMessage(raw);
        if (!message) continue;
        if (put(message)) { touched.add(message.chat_id); added++; }
      }
      trimTouched(touched);
      return added;
    },
    hydrate(snapshot) {
      this.upsertChats(snapshot?.chats ?? []);
      this.upsertContacts(snapshot?.contacts ?? []);
      const touched = new Set();
      for (const message of snapshot?.messages ?? []) {
        if (!message?.id || !message?.chat_id || !message?.timestamp || !message?.type) continue;
        if (put(message)) touched.add(message.chat_id);
      }
      trimTouched(touched);
    },
    toJSON() {
      return {
        chats: [...chats.values()],
        contacts: [...contacts.values()],
        messages: [...messages.values()].flatMap(bucket => [...bucket.values()]),
      };
    },
    listChats(limit) {
      const items = [...chats.values()].map(chat => {
        const bucket = messages.get(chat.id);
        const last = bucket ? latest(bucket) : null;
        const at = last ? timeOf(last) : secondsToMillis(chat.conversationTimestamp);
        return {
          id: chat.id,
          name: nameOf(chat.id),
          is_group: chat.id.endsWith('@g.us'),
          unread_count: Math.max(0, Number(chat.unreadCount ?? 0)),
          archived: Boolean(chat.archived),
          last_message_at: at ? new Date(at).toISOString() : null,
          last_message_preview: last ? preview(last) : null,
        };
      }).sort((a, b) => Date.parse(b.last_message_at ?? 0) - Date.parse(a.last_message_at ?? 0));
      return { chats: items.slice(0, limit), total: items.length, truncated: items.length > limit };
    },
    messagesFor(chatId, limit) {
      const bucket = messages.get(chatId);
      if (!bucket) return { messages: [], total: 0, truncated: false };
      const all = [...bucket.values()].sort((a, b) => timeOf(a) - timeOf(b));
      return { messages: all.slice(-limit), total: all.length, truncated: all.length > limit };
    },
    search(query, chatId, limit) {
      const needle = query.toLowerCase();
      const hits = [];
      let scanned = 0;
      for (const [id, bucket] of messages) {
        if (chatId && id !== chatId) continue;
        for (const message of bucket.values()) {
          scanned++;
          if (message.text?.toLowerCase().includes(needle)) hits.push({ ...message, chat_name: nameOf(id) });
        }
      }
      hits.sort((a, b) => timeOf(b) - timeOf(a));
      return { matches: hits.slice(0, limit), scanned, total: hits.length, truncated: hits.length > limit };
    },
    counts() {
      let count = 0, oldest = null, newest = null;
      for (const bucket of messages.values()) {
        count += bucket.size;
        for (const message of bucket.values()) {
          const at = timeOf(message);
          if (!oldest || at < timeOf(oldest)) oldest = message;
          if (!newest || at > timeOf(newest)) newest = message;
        }
      }
      return { chat_count: chats.size, message_count: count, oldest_message_at: oldest?.timestamp ?? null, newest_message_at: newest?.timestamp ?? null };
    },
  };
}
