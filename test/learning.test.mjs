import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { learnReadWorkflow, readEngineHash, validateLearnedWorkflow } from '../src/learning.mjs';
import { loadLearnedWorkflows } from '../src/external-workflows.mjs';

function scenario() {
  const records = ['Alpha', 'Beta', 'Gamma'].map((name, index) => ({ reference: index + 7, label: `${name} phone`, price: (index + 1) * 100 }));
  const approved_requests = [{ origin: 'https://new-site.example', path: '/list', method: 'POST' }, { origin: 'https://new-site.example', path: '/detail', method: 'POST' }];
  const traces = records.map(record => ({ input: { title: record.label }, calls: [
    { ...approved_requests[0], encoding: 'json', params: { type: 'phone' }, status: 200, response: { data: { entries: records } } },
    { ...approved_requests[1], encoding: 'json', params: { reference: String(record.reference) }, status: 200, response: record },
  ] }));
  return { records, request: { id: 'find_new_phone', description: 'Find a phone through a learned list and detail workflow.', effect: 'read', source_mode: 'observed_first_party_http', approved_requests, training: traces.slice(0, 2), evaluation: traces.slice(2) } };
}

test('learn, save, load and call an unseen contract without changing the engine', async t => {
  const { records, request } = scenario();
  t.mock.method(globalThis, 'fetch', async (url, options) => Response.json(String(url).endsWith('/list') ? { data: { entries: records } } : records.find(row => String(row.reference) === JSON.parse(options.body).reference)));
  const bundle = await learnReadWorkflow(request);
  assert.equal(bundle.verification.held_out_inputs[0].title, 'Gamma phone');
  const directory = await mkdtemp(join(tmpdir(), 'web2api-learn-test-'));
  try {
    await writeFile(join(directory, 'new.workflow.json'), JSON.stringify(bundle));
    const catalog = await loadLearnedWorkflows(directory);
    assert.deepEqual(Object.keys(catalog.definitions), ['find_new_phone']);
    assert.equal((await catalog.run('find_new_phone', { title: 'Gamma phone' })).data.reference, 9);
    const tampered = structuredClone(bundle); tampered.recipe.steps[0].params.type.value = 'other';
    assert.throws(() => validateLearnedWorkflow(tampered, bundle.verification.engine_hash), error => error.code === 'CATALOG_NOT_VERIFIED');
    assert.throws(() => validateLearnedWorkflow(bundle, '0'.repeat(64)), error => error.code === 'CATALOG_NOT_VERIFIED');
    await writeFile(join(directory, 'duplicate.workflow.json'), JSON.stringify(bundle));
    await assert.rejects(loadLearnedWorkflows(directory), error => error.code === 'DUPLICATE_WORKFLOW');
  } finally {
    assert(resolve(directory).startsWith(resolve(tmpdir())) && directory.includes('web2api-learn-test-'));
    await rm(directory, { recursive: true, force: true });
  }
});

test('learning refuses writes, reused evaluation and an independently wrong expected output', async t => {
  const { records, request } = scenario();
  await assert.rejects(learnReadWorkflow({ ...request, effect: 'write' }), error => error.code === 'UNREVIEWED_OPERATION');
  await assert.rejects(learnReadWorkflow({ ...request, evaluation: request.training.slice(0, 1) }), error => error.code === 'HELD_OUT_INPUT_REQUIRED');
  const faultyRecords = records.map(row => ({ ...row, price: row.price + 1 }));
  t.mock.method(globalThis, 'fetch', async (url, options) => Response.json(String(url).endsWith('/list') ? { data: { entries: faultyRecords } } : faultyRecords.find(row => String(row.reference) === JSON.parse(options.body).reference)));
  await assert.rejects(learnReadWorkflow(request), error => error.code === 'EVALUATION_MISMATCH');
  assert.match(await readEngineHash(), /^[a-f0-9]{64}$/);
});
