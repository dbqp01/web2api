import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore, normalizeMessage } from '../src/whatsapp-store.mjs';

const raw = (id, chat, seconds, message, extra = {}) => ({
  key: { id, remoteJid: chat, fromMe: false, ...extra },
  messageTimestamp: seconds,
  message,
});
const text = (id, chat, seconds, body, extra) => raw(id, chat, seconds, { conversation: body }, extra);

test('normalizes text, captions and skips protocol traffic', () => {
  assert.equal(normalizeMessage(text('1', 'a@s.whatsapp.net', 1_700_000_000, 'hola')).text, 'hola');
  assert.equal(normalizeMessage(raw('2', 'a@s.whatsapp.net', 1_700_000_001, { extendedTextMessage: { text: 'extendido' } })).text, 'extendido');
  const image = normalizeMessage(raw('3', 'a@s.whatsapp.net', 1_700_000_002, { imageMessage: { caption: 'foto' } }));
  assert.equal(image.text, 'foto');
  assert.equal(image.type, 'imageMessage');
  assert.equal(image.has_media, true);
  assert.equal(normalizeMessage(raw('4', 'a@s.whatsapp.net', 1_700_000_003, { protocolMessage: { type: 0 } })), null);
  assert.equal(normalizeMessage(raw('5', 'a@s.whatsapp.net', 0, { conversation: 'sin fecha' })), null);
  const group = normalizeMessage(text('6', 'g@g.us', 1_700_000_004, 'grupo', { participant: 'b@s.whatsapp.net' }));
  assert.equal(group.sender_jid, 'b@s.whatsapp.net');
  assert.equal(group.from_me, false);
  const sent = normalizeMessage(raw('7', 'a@s.whatsapp.net', 1_700_000_005, { deviceSentMessage: { message: { conversation: 'desde otro dispositivo' } } }));
  assert.equal(sent.text, 'desde otro dispositivo');
  assert.equal(sent.type, 'conversation');
  const ephemeral = normalizeMessage(raw('8', 'a@s.whatsapp.net', 1_700_000_006, { ephemeralMessage: { message: { extendedTextMessage: { text: 'efímero' } } } }));
  assert.equal(ephemeral.text, 'efímero');
  assert.equal(normalizeMessage(raw('9', 'a@s.whatsapp.net', 1_700_000_007, { ephemeralMessage: {} })), null);
});

test('stores chats, contacts, deduplicates and trims the oldest messages', () => {
  const store = createStore({ maxMessagesPerChat: 3 });
  store.upsertContacts([{ id: 'a@s.whatsapp.net', notify: 'Ana' }]);
  store.upsertChats([{ id: 'a@s.whatsapp.net', unreadCount: 2 }]);
  store.addMessages([
    text('1', 'a@s.whatsapp.net', 1_700_000_000, 'uno'),
    text('2', 'a@s.whatsapp.net', 1_700_000_001, 'dos'),
    text('2', 'a@s.whatsapp.net', 1_700_000_001, 'dos'),
    text('3', 'a@s.whatsapp.net', 1_700_000_002, 'tres'),
    text('4', 'a@s.whatsapp.net', 1_700_000_003, 'cuatro'),
  ]);
  const result = store.messagesFor('a@s.whatsapp.net', 10);
  assert.deepEqual(result.messages.map(m => m.text), ['dos', 'tres', 'cuatro']);
  assert.equal(result.total, 3);
  const listed = store.listChats(10);
  assert.equal(listed.chats[0].name, 'Ana');
  assert.equal(listed.chats[0].unread_count, 2);
  assert.equal(listed.chats[0].last_message_preview, 'cuatro');
  assert.equal(store.counts().message_count, 3);
});

test('sorting, truncation and group names', () => {
  const store = createStore();
  store.upsertChats([
    { id: 'g@g.us', subject: 'Equipo' },
    { id: 'b@s.whatsapp.net', name: 'Bruno' },
  ]);
  store.addMessages([
    text('1', 'g@g.us', 1_700_000_000, 'viejo'),
    text('2', 'b@s.whatsapp.net', 1_700_000_100, 'nuevo'),
  ]);
  const all = store.listChats(10);
  assert.deepEqual(all.chats.map(c => c.name), ['Bruno', 'Equipo']);
  assert.equal(all.chats[1].is_group, true);
  assert.equal(store.listChats(1).truncated, true);
  assert.equal(store.messagesFor('b@s.whatsapp.net', 1).truncated, false);
});

test('search is case-insensitive and can be scoped to a chat', () => {
  const store = createStore();
  store.upsertChats([{ id: 'a@s.whatsapp.net', name: 'Ana' }, { id: 'b@s.whatsapp.net', name: 'Bruno' }]);
  store.addMessages([
    text('1', 'a@s.whatsapp.net', 1_700_000_000, 'Presupuesto de octubre'),
    text('2', 'b@s.whatsapp.net', 1_700_000_100, 'presupuesto aprobado'),
    text('3', 'b@s.whatsapp.net', 1_700_000_200, 'otra cosa'),
  ]);
  const all = store.search('PRESUPUESTO', undefined, 10);
  assert.equal(all.total, 2);
  assert.equal(all.matches[0].chat_name, 'Bruno');
  const scoped = store.search('presupuesto', 'a@s.whatsapp.net', 10);
  assert.equal(scoped.total, 1);
  assert.equal(scoped.scanned, 1);
  assert.equal(scoped.matches[0].chat_id, 'a@s.whatsapp.net');
});

test('round-trips a snapshot without changing chats or messages', () => {
  const store = createStore();
  store.upsertChats([{ id: 'a@s.whatsapp.net', name: 'Ana' }]);
  store.upsertContacts([{ id: 'a@s.whatsapp.net', name: 'Ana' }]);
  store.addMessages([text('1', 'a@s.whatsapp.net', 1_700_000_000, 'hola')]);
  const restored = createStore();
  restored.hydrate(JSON.parse(JSON.stringify(store.toJSON())));
  assert.deepEqual(restored.listChats(10), store.listChats(10));
  assert.deepEqual(restored.messagesFor('a@s.whatsapp.net', 10), store.messagesFor('a@s.whatsapp.net', 10));
  assert.equal(restored.search('hola', undefined, 10).total, 1);
});

test('evicts the least recently active chat when the cap is reached', () => {
  const store = createStore({ maxChats: 2 });
  store.upsertChats([{ id: 'a@s.whatsapp.net', conversationTimestamp: 1_700_000_000 }]);
  store.upsertChats([{ id: 'b@s.whatsapp.net', conversationTimestamp: 1_700_000_100 }]);
  store.upsertChats([{ id: 'c@s.whatsapp.net', conversationTimestamp: 1_700_000_200 }]);
  assert.deepEqual(store.listChats(10).chats.map(c => c.id).sort(), ['b@s.whatsapp.net', 'c@s.whatsapp.net']);
});
