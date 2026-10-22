import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { createLab } from '../src/lab.mjs';
import { createApi } from '../src/api.mjs';
import { listen } from '../src/http.mjs';
import { createRunner } from '../src/runner.mjs';
import { compile } from '../src/compiler.mjs';
import { digest } from '../src/catalog.mjs';
import { discover } from './discover.mjs';

await mkdir('.local', { recursive: true });
await mkdir('artifacts', { recursive: true });
const recipePath = resolve('.local/recipe.json');
const report = { started_at: new Date().toISOString(), scope: 'controlled_lab_only', discovery: 'scripted_ui_demonstrations', autonomous_discovery: false, browser_closed_before_replay: false, accepted_workflows: [], status: 'failed', checks: [], timings_ms: [], successful_replay_calls: 0, replay_sessions: 0 };
let lab, running, recipe;
try {
  lab = await createLab({ stateFile: resolve('.local/discovery-cart.json') });
  running = await listen(lab.server);
  const start = performance.now();
  const observations = await discover(running.origin, resolve('artifacts/lab.png'));
  report.discovery_ms = performance.now() - start;
  report.browser_closed_before_replay = true;
  recipe = compile(observations);
  await writeFile('.local/observations.json', JSON.stringify(observations, null, 2));
  await writeFile(recipePath, JSON.stringify(recipe, null, 2));
  await running.close(); running = null;

  for (let session = 0; session < 3; session++) {
    lab = await createLab({ stateFile: resolve(`.local/replay-${session}.json`) });
    running = await listen(lab.server);
    const run = createRunner({ recipe, origin: running.origin, token: lab.token });
    for (let i = 0; i < 5; i++) {
      const start = performance.now();
      const found = await run('search_products', { query: 'Taza' });
      assert.deepEqual(found.data.products.map(p => p.sku), ['cup']);
      report.successful_replay_calls++;
      const empty = await run('search_products', { query: 'no-such-product' });
      assert.deepEqual(empty.data.products, []);
      report.successful_replay_calls++;
      const limited = await run('search_products', { query: '', max_results: 1 });
      assert.equal(limited.data.products.length, 1); assert.equal(limited.data.truncated, true);
      report.successful_replay_calls++;
      const added = await run('add_to_cart', { sku: 'tea', quantity: 1, confirmed: true });
      assert.deepEqual(added.data.items, (await lab.oracle()).items);
      assert.equal(added.data.items.find(p => p.sku === 'tea').quantity, i + 1);
      report.successful_replay_calls++;
      const cart = await run('get_cart', {});
      assert.deepEqual(cart.data.items, (await lab.oracle()).items);
      report.successful_replay_calls++;
      report.timings_ms.push(performance.now() - start);
    }
    for (const [fault, name, input, code] of [
      ['false_success', 'add_to_cart', { sku: 'cup', quantity: 1, confirmed: true }, 'EFFECT_UNVERIFIED'],
      ['schema', 'search_products', { query: 'Taza' }, 'UPSTREAM_CHANGED'],
      ['rate_limit', 'get_cart', {}, 'RATE_LIMITED'],
      ['route', 'add_to_cart', { sku: 'cup', quantity: 1, confirmed: true }, 'UPSTREAM_CHANGED'],
    ]) {
      lab.setFault(fault);
      await assert.rejects(run(name, input), e => e.code === code);
      report.checks.push({ session, case: fault, status: 'passed' });
    }
    lab.setFault(null);
    const invalidSession = createRunner({ recipe, origin: running.origin, token: 'invalid' });
    await assert.rejects(invalidSession('get_cart', {}), e => e.code === 'AUTH_EXPIRED');
    await assert.rejects(run('add_to_cart', { sku: 'cup', quantity: 1, confirmed: false }), e => e.code === 'INVALID_INPUT');
    report.checks.push({ session, case: 'auth_and_confirmation_rejected', status: 'passed' });
    report.replay_sessions++;
    await running.close(); running = null;
  }
  report.recipe_hash = digest(recipe);
  report.accepted_workflows = ['search_products', 'get_cart', 'add_to_cart'];
  report.status = 'passed';
  await writeFile(`${recipePath}.verification.json`, JSON.stringify(report, null, 2));

  lab = await createLab({ stateFile: resolve('.local/protocol-cart.json') });
  running = await listen(lab.server);
  const env = { ...process.env, WEB2API_ORIGIN: running.origin, WEB2API_UPSTREAM_TOKEN: lab.token, WEB2API_RECIPE: recipePath };
  const client = new Client({ name: 'web2api-independent-consumer', version: '0.1.0' });
  try {
    await client.connect(new StdioClientTransport({ command: process.execPath, args: [resolve('src/mcp.mjs')], env }));
    assert.deepEqual((await client.listTools()).tools.map(t => t.name).sort(), [...report.accepted_workflows].sort());
    const found = await client.callTool({ name: 'search_products', arguments: { query: 'Taza' } });
    assert.equal(found.isError, undefined); assert.equal(found.structuredContent.data.products[0].sku, 'cup');
    const added = await client.callTool({ name: 'add_to_cart', arguments: { sku: 'cup', quantity: 2, confirmed: true } });
    assert.equal(added.isError, undefined); assert.equal((await lab.oracle()).items[0].quantity, 2);
    const denied = await client.callTool({ name: 'add_to_cart', arguments: { sku: 'cup', quantity: 1, confirmed: false } });
    assert.equal(denied.isError, true);
    report.checks.push({ case: 'mcp_handshake_catalog_read_write_rejected_input', status: 'passed' });
  } finally { await client.close(); }
  const apiKey = randomBytes(32).toString('hex');
  const api = await listen(createApi({ run: createRunner({ recipe, origin: running.origin, token: lab.token }), apiKey }));
  try {
    assert.equal((await fetch(`${api.origin}/v1/catalog`)).status, 401);
    const response = await fetch(`${api.origin}/v1/workflows/get_cart`, { method: 'POST', headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' }, body: '{}' });
    assert.equal(response.status, 200); assert.equal((await response.json()).data.items[0].quantity, 2);
    report.checks.push({ case: 'rest_authenticated_consumer_and_rejected_anonymous', status: 'passed' });
  } finally { await api.close(); }
  report.false_successes_observed = 0;
  report.finished_at = new Date().toISOString();
  report.status = 'passed';
} catch (error) {
  report.status = 'failed';
  report.failure = { code: error.code || error.name, message: error.message };
  throw error;
} finally {
  if (running) await running.close();
  await writeFile(`${recipePath}.verification.json`, JSON.stringify(report, null, 2));
  await writeFile('artifacts/lab-report.json', JSON.stringify(report, null, 2));
}
console.log(JSON.stringify({ status: report.status, replay_calls: report.successful_replay_calls, sessions: report.replay_sessions, negative_checks: report.checks.length, report: 'artifacts/lab-report.json' }, null, 2));
