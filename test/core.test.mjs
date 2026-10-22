import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createLab } from '../src/lab.mjs';
import { createRunner } from '../src/runner.mjs';
import { listen } from '../src/http.mjs';
import { compile } from '../src/compiler.mjs';

const recipe = { version: 1, source_mode: 'observed_first_party_http', scope: 'controlled_lab_only', observed_at: new Date().toISOString(), operations: {
  search_products: { method: 'GET', path: '/x/p7', query_key: 'term', limit_key: 'take' },
  get_cart: { method: 'GET', path: '/x/c9' },
  add_to_cart: { method: 'POST', path: '/x/m4', sku_key: 'item', quantity_key: 'units' },
} };

test('compiler rejects missing evidence and constant parameters', () => {
  assert.throws(() => compile([]), e => e.code === 'INSUFFICIENT_EVIDENCE');
  const rows = [1, 2].flatMap(n => [
    { intent: 'search_products', input: { query: 'tea', max_results: n }, method: 'GET', path: '/x/p7', status: 200, query: { term: 'tea', take: String(n) } },
    { intent: 'get_cart', input: {}, method: 'GET', path: '/x/c9', status: 200 },
    { intent: 'add_to_cart', input: { sku: `s${n}`, quantity: n }, method: 'POST', path: '/x/m4', status: 200, body: { item: `s${n}`, units: n } },
  ]);
  assert.throws(() => compile(rows), e => e.code === 'UNPROVEN_PARAMETER');
  rows.find(r => r.intent === 'search_products').input.query = 'cup';
  rows.find(r => r.intent === 'search_products').query.term = 'cup';
  assert.deepEqual(compile(rows).operations, recipe.operations);
});

test('recipes cannot redirect or request a remote origin', () => {
  assert.throws(() => createRunner({ recipe, origin: 'https://example.com' }), e => e.code === 'ORIGIN_REJECTED');
  const unsafe = structuredClone(recipe); unsafe.operations.get_cart.path = '//example.com';
  assert.throws(() => createRunner({ recipe: unsafe, origin: 'http://127.0.0.1:1234' }), e => e.code === 'INVALID_RECIPE');
});

test('live lab verifies writes, empty results, rejected input/session and false HTTP success', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'web2api-test-'));
  const lab = await createLab({ stateFile: join(dir, 'cart.json') });
  const running = await listen(lab.server);
  try {
    const run = createRunner({ recipe, origin: running.origin, token: lab.token });
    assert.deepEqual((await run('search_products', { query: 'missing' })).data.products, []);
    await assert.rejects(run('add_to_cart', { sku: 'tea', quantity: 1 }), e => e.code === 'INVALID_INPUT');
    await assert.rejects(run('add_to_cart', { sku: 'tea', quantity: -1, confirmed: true }), e => e.code === 'INVALID_INPUT');
    const result = await run('add_to_cart', { sku: 'tea', quantity: 2, confirmed: true });
    assert.equal(result.data.subtotal_cents, 2400);
    assert.deepEqual(result.data.items, (await lab.oracle()).items);
    lab.setFault('false_success');
    await assert.rejects(run('add_to_cart', { sku: 'tea', quantity: 1, confirmed: true }), e => e.code === 'EFFECT_UNVERIFIED');
    assert.equal((await lab.oracle()).items[0].quantity, 2);
    lab.setFault(null);
    const unauthorized = createRunner({ recipe, origin: running.origin });
    await assert.rejects(unauthorized('get_cart', {}), e => e.code === 'AUTH_EXPIRED');
    lab.setFault('schema'); await assert.rejects(run('search_products', { query: '' }), e => e.code === 'UPSTREAM_CHANGED');
    lab.setFault('rate_limit'); await assert.rejects(run('get_cart', {}), e => e.code === 'RATE_LIMITED');
  } finally { await running.close(); await rm(dir, { recursive: true, force: true }); }
});
