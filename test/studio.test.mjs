import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inputValues, defaultValue, curlRequest, captureSummary } from '../web/studio.js';
import { startStudioDemo } from '../scripts/studio-demo.mjs';
import { createApp } from '../src/app.mjs';
import { listen } from '../src/http.mjs';
import { connectionStatus } from '../src/connections.mjs';

test('studio input conversion preserves empty searches, omits optional blanks, and requires typed values', () => {
  const properties = { query: { type: 'string' }, max_results: { type: 'integer' }, confirmed: { type: 'boolean' }, count: { type: 'integer' }, list: { type: 'array' } };
  assert.deepEqual(inputValues(properties, { query: '', max_results: '', confirmed: true, count: '2' }, ['query']), { query: '', confirmed: true, count: 2 });
  assert.deepEqual(inputValues({ confirmed: properties.confirmed }, { confirmed: false }), { confirmed: false });
  assert.throws(() => inputValues(properties, { count: '2.5' }), /INVALID_INPUT/);
  assert.throws(() => inputValues(properties, { count: '' }, ['count']), /INVALID_INPUT/);
  assert.throws(() => inputValues(properties, { list: '{}' }), /INVALID_INPUT/);
  assert.equal(defaultValue('confirmed', { type: 'boolean', default: true }, 'add_to_cart'), false);
  assert.equal(defaultValue('check_out', { format: 'date' }, 'search', new Date('2026-10-22T12:00:00Z')), '2026-11-08');
  assert(curlRequest('http://127.0.0.1:4320', 'search_products', { query: "O'Reilly $(whoami)" }).includes("O'\\''Reilly $(whoami)"));
  assert.throws(() => captureSummary({ id: 'test', training: [], evaluation: [], approved_requests: [null] }), /INVALID_CAPTURE/);
});

test('offline studio exercises real HTTP search, explicit confirmation and verified cart persistence', async () => {
  const demo = await startStudioDemo({ port: 0 });
  try {
    const cookie = (await fetch(demo.origin)).headers.get('set-cookie').split(';')[0];
    const headers = { Cookie: cookie, 'Content-Type': 'application/json' };
    const post = (name, body) => fetch(`${demo.origin}/v1/workflows/${name}`, { method: 'POST', headers, body: JSON.stringify(body) });
    const catalog = await (await fetch(`${demo.origin}/v1/catalog`, { headers })).json();
    assert.equal(catalog.scope, 'controlled_lab_only'); assert.equal(catalog.workflows.length, 3);
    const search = await (await post('search_products', { query: '' })).json(); assert.equal(search.data.total, 3); assert.equal(search.data.currency, 'PEN');
    const empty = await (await post('get_cart', {})).json(); assert.equal(empty.data.subtotal_cents, 0);
    assert.equal((await post('add_to_cart', { sku: 'coffee', quantity: 2, confirmed: false })).status, 400);
    const added = await (await post('add_to_cart', { sku: 'coffee', quantity: 2, confirmed: true })).json();
    assert.equal(added.data.subtotal_cents, 5000); assert.equal(added.evidence.verification, 'independent_cart_read');
    const cart = await (await post('get_cart', {})).json(); assert.deepEqual(cart.data, added.data);
    assert.equal((await fetch(`${demo.origin}/v1/connections`)).status, 401);
    assert.equal((await fetch(`${demo.origin}/v1/connections`, { headers: { ...headers, Origin: 'https://other.example' } })).status, 403);
    const connections = await (await fetch(`${demo.origin}/v1/connections`, { headers })).json(); assert.deepEqual(connections.connections.map(c => c.id), ['lab']);
    for (const path of ['/studio.js', '/icons.svg', '/favicon.svg', '/fonts/plex-sans-400.ttf']) assert.equal((await fetch(demo.origin + path)).status, 200);
    assert.equal((await fetch(`${demo.origin}/fonts/../package.json`)).status, 401);
  } finally { await demo.close(); }
});

test('connection metadata discloses capabilities without loading personal session content', () => {
  const metadata = connectionStatus({ public_read: { effect: 'read' }, uvcv_list_courses: { auth: 'user_session' } }, 'verified_reads');
  assert.deepEqual(metadata.connections[0].workflow_ids, ['public_read']); assert.equal(metadata.connections[1].available, true);
  assert.equal(metadata.connections.find(c => c.id === 'whatsapp').available, false);
  const serialized = JSON.stringify(metadata);
  assert(!/self_jid|MoodleSession|access_token|creds\.json|[A-Z]:\\|cookie=/.test(serialized));
});

test('learning refuses the twenty-first bundle before calling upstream or writing a file', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'web2api-limit-'));
  for (let i = 0; i < 20; i++) await writeFile(join(directory, `${i}.workflow.json`), '{}');
  const app = await listen(await createApp({ stateDirectory: directory, catalog: { definitions: {}, run() {} } }));
  try {
    const cookie = (await fetch(app.origin)).headers.get('set-cookie').split(';')[0];
    const response = await fetch(`${app.origin}/v1/learn`, { method: 'POST', headers: { Cookie: cookie, 'Content-Type': 'application/json' }, body: JSON.stringify({ reviewed: true, capture: { id: 'new_workflow' } }) });
    assert.equal(response.status, 409); assert.equal((await response.json()).error.code, 'WORKFLOW_LIMIT');
  } finally { await app.close(); await rm(directory, { recursive: true, force: true }); }
});
