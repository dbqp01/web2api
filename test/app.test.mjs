import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { z } from 'zod';
import { createApp } from '../src/app.mjs';
import { listen } from '../src/http.mjs';
import { loadLearnedWorkflows } from '../src/external-workflows.mjs';

test('standalone UI authenticates locally without exposing the REST key; foreign origins are rejected', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'web2api-app-test-'));
  const apiKey = 'test-key-never-serialized-0123456789';
  const catalog = { definitions: { echo_read_2: { input: z.object({ text: z.string() }), description: 'Echo for local contract testing.', effect: 'read' } }, run: async (_, input) => ({ data: input }) };
  const running = await listen(await createApp({ stateDirectory: directory, apiKey, catalog }));
  try {
    assert.equal((await fetch(`${running.origin}/v1/catalog`)).status, 401);
    const page = await fetch(running.origin, { headers: { 'Sec-Fetch-Site': 'cross-site' } });
    assert.equal(page.status, 200, 'Ordinary top-level navigation must work');
    const html = await page.text(); assert(html.includes('Workflow Studio')); assert(!html.includes(apiKey));
    const setCookie = page.headers.get('set-cookie'); assert(setCookie.includes('HttpOnly')); assert(setCookie.includes('SameSite=Strict'));
    assert(page.headers.get('content-security-policy').includes("frame-ancestors 'none'"));
    const headers = { Cookie: setCookie.split(';')[0] };
    const response = await fetch(`${running.origin}/v1/catalog`, { headers });
    assert.equal(response.status, 200); const data = await response.json();
    assert(data.workflows[0].input_schema.properties.text); assert(!JSON.stringify(data).includes(apiKey));
    assert.equal((await fetch(`${running.origin}/v1/catalog`, { headers: { ...headers, Origin: 'https://other.example' } })).status, 403);
    assert.equal((await fetch(`${running.origin}/v1/workflows/echo_read_2`, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ text: 'tested' }) })).status, 200);
    assert.equal((await fetch(`${running.origin}/v1/learn`, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ reviewed: false }) })).status, 403);
    assert.equal((await fetch(`${running.origin}/v1/catalog`, { headers: { Authorization: `Bearer ${apiKey}` } })).status, 200);
  } finally {
    await running.close(); assert(resolve(directory).startsWith(resolve(tmpdir())) && directory.includes('web2api-app-test-'));
    await rm(directory, { recursive: true, force: true });
  }
});

test('learning endpoint persists a verified workflow and makes it callable without restarting', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'web2api-app-test-'));
  const capture = JSON.parse(await readFile('examples/learn-laptop.json', 'utf8'));
  const records = capture.training[0].calls[0].response;
  const details = [...capture.training, ...capture.evaluation].map(trace => trace.calls.at(-1).response);
  const realFetch = globalThis.fetch;
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    if (new URL(url).origin !== 'https://api.demoblaze.com') return realFetch(url, init);
    return Response.json(new URL(url).pathname === '/bycat' ? records : details.find(record => String(record.id) === JSON.parse(init.body).id));
  });
  const running = await listen(await createApp({ stateDirectory: directory, catalog: { definitions: {}, run: () => { throw Error('Unknown workflow'); } } }));
  try {
    const cookie = (await fetch(running.origin)).headers.get('set-cookie').split(';')[0];
    const headers = { Cookie: cookie, 'Content-Type': 'application/json' };
    const post = (path, body) => fetch(`${running.origin}${path}`, { method: 'POST', headers, body: JSON.stringify(body) });
    const response = await post('/v1/learn', { reviewed: true, capture });
    assert.equal(response.status, 201); assert.equal((await response.json()).available_now, true);
    const catalog = await (await fetch(`${running.origin}/v1/catalog`, { headers })).json();
    assert.equal(catalog.workflows[0].id, capture.id);
    const contract = await (await fetch(`${running.origin}/v1/openapi.json`, { headers })).json();
    assert.equal(contract.paths[`/v1/workflows/${capture.id}`].post.operationId, capture.id);
    assert(contract.paths['/v1/learn']);
    const result = await (await post(`/v1/workflows/${capture.id}`, { product_name: 'MacBook Pro' })).json();
    assert.equal(result.data.id, 15);
    assert.equal((await loadLearnedWorkflows(directory)).definitions[capture.id].effect, 'read');
    assert.equal((await post('/v1/learn', { reviewed: true, capture })).status, 409);
  } finally {
    await running.close(); assert(resolve(directory).startsWith(resolve(tmpdir())) && directory.includes('web2api-app-test-'));
    await rm(directory, { recursive: true, force: true });
  }
});
