import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createWhatsAppRunner, whatsappAuthAvailable, whatsappInputs, whatsappOutputs } from '../src/whatsapp.mjs';
import { digest } from '../src/catalog.mjs';

if (!whatsappAuthAvailable()) {
  console.error('WhatsApp is not paired. Run npm run whatsapp:login first.');
  process.exit(1);
}

const runner = createWhatsAppRunner();
const sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
const checks = {};
let status;

try {
  await runner.start();
  const deadline = Date.now() + 90_000;
  for (;;) {
    status = (await runner.run('whatsapp_status', {})).data;
    if (status.state === 'logged_out') throw new Error('REAUTH_REQUIRED');
    if (status.state === 'connected' && (status.history_synced || status.chat_count > 0)) break;
    if (Date.now() > deadline) break;
    await sleep(2000);
  }
  assert.equal(status.state, 'connected', `WhatsApp state is ${status.state}`);
  checks.connected = true;

  const listed = await runner.run('whatsapp_list_chats', { limit: 50 });
  assert.equal(whatsappOutputs.whatsapp_list_chats.safeParse(listed).success, true);
  assert.equal(new Set(listed.data.chats.map(chat => chat.id)).size, listed.data.chats.length);
  checks.chats_listed = listed.data.chats.length;
  checks.chat_ids_unique = true;
  assert(listed.data.chats.length > 0, 'No chats were synced; keep the process open for the initial history sync.');

  let conversation = null;
  for (const chat of listed.data.chats.slice(0, 25)) {
    const result = await runner.run('whatsapp_get_messages', { chat_id: chat.id, limit: 20 });
    assert.equal(whatsappOutputs.whatsapp_get_messages.safeParse(result).success, true);
    assert(result.data.messages.every(message => message.chat_id === chat.id));
    const times = result.data.messages.map(message => Date.parse(message.timestamp));
    assert(times.every((time, index) => index === 0 || time >= times[index - 1]));
    assert(result.data.messages.every(message => (message.text?.length ?? 0) <= 4000));
    if (result.data.messages.length > 0 && !conversation) conversation = { chat, result };
  }
  assert(conversation, 'No messages were synced in the first 25 chats.');
  checks.messages_fetched = conversation.result.data.messages.length;
  checks.messages_ordered = true;
  checks.chat_membership = true;

  const sample = conversation.result.data.messages.findLast(message => message.text && message.text.length >= 4);
  const query = sample ? sample.text.slice(0, Math.min(20, sample.text.length)) : '__web2api_no_match__';
  const searched = await runner.run('whatsapp_search_messages', { query, limit: 20 });
  assert.equal(whatsappOutputs.whatsapp_search_messages.safeParse(searched).success, true);
  if (sample) assert(searched.data.total >= 1, 'Known text was not found by search');
  else assert.equal(searched.data.total, 0);
  const scoped = await runner.run('whatsapp_search_messages', { query, chat_id: conversation.chat.id, limit: 20 });
  assert.equal(whatsappOutputs.whatsapp_search_messages.safeParse(scoped).success, true);
  assert(scoped.data.matches.every(match => match.chat_id === conversation.chat.id));
  checks.search_hits = searched.data.total;
  checks.search_scoped = true;
  if (sample) checks.search_known_text = true;

  assert.equal(whatsappInputs.whatsapp_get_messages.safeParse({ chat_id: '' }).success, false);
  assert.equal(whatsappInputs.whatsapp_search_messages.safeParse({ query: '' }).success, false);
  checks.input_rejected = true;

  const newest = await runner.run('whatsapp_status', {});
  assert(newest.data.chat_count >= listed.data.chats.length);
  assert(newest.data.message_count >= conversation.result.data.messages.length);
  checks.status_counts = true;

  const report = {
    status: 'passed',
    validated_at: new Date().toISOString(),
    source_mode: 'observed_first_party_protocol',
    scope: 'whatsapp_personal_read_only',
    transport: 'whatsapp_multidevice_websocket',
    checks,
    counts: {
      chats_listed: listed.data.chats.length,
      messages_fetched: checks.messages_fetched,
      search_hits: checks.search_hits,
      chat_count: newest.data.chat_count,
      message_count: newest.data.message_count,
    },
    adapter_hash: digest(await readFile('src/whatsapp.mjs', 'utf8') + await readFile('src/whatsapp-store.mjs', 'utf8')),
  };
  await mkdir('evidence', { recursive: true });
  await writeFile('evidence/whatsapp-validation.json', JSON.stringify(report, null, 2) + '\n');
  console.log('WhatsApp read-only validation passed.');
  console.log(JSON.stringify(report.counts));
} catch (error) {
  console.error(`WhatsApp validation failed: ${error.code ?? error.message}`);
  process.exitCode = 1;
} finally {
  await runner.close();
}
