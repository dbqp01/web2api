import test from 'node:test';
import assert from 'node:assert/strict';
import { compileReadWorkflow, createReadWorkflowRunner } from '../src/read-workflow.mjs';

const approvedRequests = [{ origin: 'https://shop.example', method: 'POST', path: '/category' }, { origin: 'https://shop.example', method: 'POST', path: '/detail' }];
const products = [{ id: 11, title: 'Alpha phone', price: 100 }, { id: 22, title: 'Beta phone', price: 200 }, { id: 33, title: 'Gamma phone', price: 300 }];
function demonstrations() {
  return products.slice(0, 2).map(product => ({ input: { product_name: product.title }, calls: [
    { ...approvedRequests[0], encoding: 'json', params: { kind: 'phone' }, status: 200, response: { Items: structuredClone(products) } },
    { ...approvedRequests[1], encoding: 'json', params: { id: String(product.id) }, status: 200, response: structuredClone(product) },
  ] }));
}

test('infers data dependency across two demonstrations and replays an unseen product', async t => {
  const recipe = compileReadWorkflow({ id: 'lookup_phone', traces: demonstrations(), approvedRequests });
  assert.equal(recipe.steps[1].params.id.kind, 'selection');
  assert.equal(recipe.steps[1].params.id.value_field, 'id');
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    calls.push({ url: String(url), body: JSON.parse(options.body) });
    return Response.json(String(url).endsWith('/category') ? { Items: products } : products.find(p => String(p.id) === JSON.parse(options.body).id));
  });
  const result = await createReadWorkflowRunner(recipe, approvedRequests)({ product_name: 'Gamma phone' });
  assert.equal(result.data.id, 33);
  assert.equal(calls[1].body.id, '33');
  assert.equal(result.evidence.steps_completed, 2);
  assert.equal(result.evidence.transport, 'http_only');
  calls.length = 0;
  await assert.rejects(createReadWorkflowRunner(recipe, approvedRequests)({ product_name: 'Absent phone' }), e => e.code === 'NO_MATCH');
  assert.equal(calls.length, 1, 'Must stop before querying an invented detail ID');
});

test('rejects false detail success, ambiguous selection and broken response contracts', async t => {
  const recipe = compileReadWorkflow({ id: 'lookup_phone', traces: demonstrations(), approvedRequests });
  let category = { Items: products }, detail = { ...products[2], price: 999 };
  t.mock.method(globalThis, 'fetch', async url => Response.json(String(url).endsWith('/category') ? category : detail));
  await assert.rejects(createReadWorkflowRunner(recipe, approvedRequests)({ product_name: 'Gamma phone' }), e => e.code === 'VERIFICATION_FAILED');
  category = { Items: [...products, products[2]] };
  await assert.rejects(createReadWorkflowRunner(recipe, approvedRequests)({ product_name: 'Gamma phone' }), e => e.code === 'AMBIGUOUS_RESULT');
  category = { result: products };
  await assert.rejects(createReadWorkflowRunner(recipe, approvedRequests)({ product_name: 'Gamma phone' }), e => e.code === 'UPSTREAM_CHANGED');
});

test('name selection trims site whitespace while preserving the original response', async t => {
  const traces = demonstrations();
  traces.forEach(trace => { trace.calls[0].response.Items[2].title += '\n'; });
  const recipe = compileReadWorkflow({ id: 'lookup_phone', traces, approvedRequests });
  const record = traces[0].calls[0].response.Items[2];
  t.mock.method(globalThis, 'fetch', async url => Response.json(String(url).endsWith('/category') ? traces[0].calls[0].response : record));
  const result = await createReadWorkflowRunner(recipe, approvedRequests)({ product_name: 'Gamma phone' });
  assert.equal(result.data.title, 'Gamma phone\n');
});

test('refuses missing API path, unreviewed requests, secrets and unproven inputs', () => {
  assert.throws(() => compileReadWorkflow({ id: 'lookup', traces: [{ input: { name: 'A' }, calls: [] }, { input: { name: 'B' }, calls: [] }], approvedRequests }), e => e.code === 'API_PATH_NOT_OBSERVED');
  assert.throws(() => compileReadWorkflow({ id: 'lookup', traces: demonstrations(), approvedRequests: [] }), e => e.code === 'UNREVIEWED_OPERATION');
  const traces = demonstrations();
  traces.forEach(t => { t.calls[0].params.password = 'private'; });
  assert.throws(() => compileReadWorkflow({ id: 'lookup', traces, approvedRequests }), e => e.code === 'SECRET_IN_RECIPE');
  const constant = demonstrations(); constant[1].input.product_name = constant[0].input.product_name;
  assert.throws(() => compileReadWorkflow({ id: 'lookup', traces: constant, approvedRequests }), e => e.code === 'UNPROVEN_PARAMETER');
});

test('search results can match a nested category when their name does not contain the query', async t => {
  const rows = [
    { id: 1, name: 'Blue shirt', price: 'Rs. 500', category: { category: 'Tops' } },
    { id: 2, name: 'Summer set', price: 'Rs. 600', category: { category: 'Dress' } },
    { id: 3, name: 'Formal shirt', price: 'Rs. 400', category: { category: 'Tshirts' } },
  ];
  const policy = [{ origin: 'https://shop.example', path: '/catalog', method: 'GET' }, { origin: 'https://shop.example', path: '/search', method: 'POST' }];
  const filter = query => rows.filter(p => (p.name + ' ' + p.category.category).toLowerCase().includes(query.toLowerCase()));
  const traces = ['top', 'dress', 'blue'].map(query => ({ input: { query }, calls: [
    { ...policy[0], encoding: 'query', params: {}, status: 200, response: { products: rows } },
    { ...policy[1], encoding: 'form', params: { term: query }, status: 200, response: { products: filter(query) } },
  ] }));
  const recipe = compileReadWorkflow({ id: 'search_clothes', traces, approvedRequests: policy });
  t.mock.method(globalThis, 'fetch', async (url, options) => Response.json({ products: String(url).endsWith('/catalog') ? rows : filter(new URLSearchParams(options.body).get('term')) }));
  const result = await createReadWorkflowRunner(recipe, policy)({ query: 'tshirt' });
  assert.equal(result.data.products[0].name, 'Formal shirt');
  assert.equal(result.data.products[0].category.category, 'Tshirts');
});

test('authenticated browser HTTP and encrypted transports cannot become public HTTP recipes', () => {
  const sessionTraces = demonstrations();
  sessionTraces.forEach(t => t.calls.forEach(c => { c.auth_context = 'browser_session'; c.transport = 'browser_session_http'; }));
  assert.throws(() => compileReadWorkflow({ id: 'session_lookup', traces: sessionTraces, approvedRequests }), e => e.code === 'SESSION_TRANSPORT_REQUIRED');
  const socketTraces = demonstrations();
  socketTraces.forEach(t => t.calls.forEach(c => { c.transport = 'encrypted_socket'; }));
  assert.throws(() => compileReadWorkflow({ id: 'socket_lookup', traces: socketTraces, approvedRequests }), e => e.code === 'UNSUPPORTED_TRANSPORT');
});

function searchScenario() {
  const rows = [
    { id: 1, name: 'Blue shirt', price: 20, category: { name: 'Tops' } },
    { id: 2, name: 'Red shirt', price: 30, category: { name: 'Tops' } },
    { id: 3, name: 'Summer set', price: 40, category: { name: 'Dress' } },
  ];
  const policy = [
    { origin: 'https://shop.example', path: '/catalog', method: 'GET', success: { responseCode: 200 } },
    { origin: 'https://shop.example', path: '/search', method: 'POST', success: { responseCode: 200 } },
  ];
  const filter = query => rows.filter(p => [p.name, p.category.name].some(text => text.toLowerCase().includes(query.toLowerCase())));
  const traces = ['top', 'dress', 'blue'].map(query => ({ input: { query }, calls: [
    { ...policy[0], encoding: 'query', params: {}, status: 200, response: { responseCode: 200, products: rows } },
    { ...policy[1], encoding: 'form', params: { term: query }, status: 200, response: { responseCode: 200, products: filter(query) } },
  ] }));
  return { rows, policy, traces, filter };
}

test('rejects false empty, partial, duplicate and altered nested results; accepts a proven empty', async t => {
  const { rows, policy, traces, filter } = searchScenario();
  const recipe = compileReadWorkflow({ id: 'search_inventory', traces, approvedRequests: policy });
  assert(recipe.checks.some(check => check.kind === 'complete_search'));
  let output = [];
  t.mock.method(globalThis, 'fetch', async url => Response.json({ responseCode: 200, products: String(url).endsWith('/catalog') ? rows : output }));
  const run = createReadWorkflowRunner(recipe, policy);
  for (const invalid of [[], [rows[0]], [rows[0], rows[0]]]) {
    output = invalid;
    await assert.rejects(run({ query: 'shirt' }), error => error.code === 'SEARCH_INCOMPLETE');
  }
  output = filter('shirt').reverse();
  assert.equal((await run({ query: 'shirt' })).data.products.length, 2, 'Order is not part of the inferred contract');
  output = [{ ...rows[0], category: { name: 'Wrong category' } }, rows[1]];
  await assert.rejects(run({ query: 'shirt' }), error => error.code === 'VERIFICATION_FAILED');
  output = [];
  assert.deepEqual((await run({ query: 'absent' })).data.products, []);
});

test('business errors in HTTP 200 are rejected at every step and before compilation', async t => {
  const { rows, policy, traces } = searchScenario();
  const recipe = compileReadWorkflow({ id: 'search_inventory', traces, approvedRequests: policy });
  let failedStep = '/catalog', calls = 0;
  t.mock.method(globalThis, 'fetch', async url => {
    calls++;
    return Response.json({ responseCode: String(url).endsWith(failedStep) ? 500 : 200, products: String(url).endsWith('/catalog') ? rows : [] });
  });
  const run = createReadWorkflowRunner(recipe, policy);
  await assert.rejects(run({ query: 'absent' }), error => error.code === 'UPSTREAM_REJECTED');
  assert.equal(calls, 1);
  failedStep = '/search';
  await assert.rejects(run({ query: 'absent' }), error => error.code === 'UPSTREAM_REJECTED');
  traces[0].calls[1].response.responseCode = 500;
  assert.throws(() => compileReadWorkflow({ id: 'search_inventory', traces, approvedRequests: policy }), error => error.code === 'UPSTREAM_REJECTED');
  const tampered = structuredClone(recipe); tampered.steps[1].success = {};
  assert.throws(() => createReadWorkflowRunner(tampered, policy), error => error.code === 'UNREVIEWED_OPERATION');
});

test('incomplete training results cannot establish a complete search contract', () => {
  const { policy, traces } = searchScenario();
  traces[0].calls[1].response.products = traces[0].calls[1].response.products.slice(0, 1);
  assert.throws(() => compileReadWorkflow({ id: 'search_inventory', traces, approvedRequests: policy }), error => error.code === 'UNPROVEN_SEARCH_COMPLETENESS');
});

test('same compiler learns 24 renamed and nested contracts with held-out queries', async t => {
  let handleRequest;
  t.mock.method(globalThis, 'fetch', (...args) => handleRequest(...args));
  for (let variant = 0; variant < 24; variant++) {
    const { rows } = searchScenario();
    const identity = `ref_${variant}`, label = `label_${variant}`, group = `group_${variant}`, collection = `rows_${variant}`, argument = `text_${variant}`;
    const records = rows.map(row => ({ [identity]: `v${variant}-${row.id}`, [label]: row.name, cost: row.price, [group]: { caption: row.category.name } }));
    const wrap = items => ({ meta: { ok: true }, payload: { [collection]: items } });
    const filter = query => records.filter(row => [row[label], row[group].caption].some(text => text.toLowerCase().includes(query.toLowerCase())));
    const policy = [
      { origin: `https://site-${variant}.example`, path: `/list_${variant}`, method: 'GET', success: { 'meta.ok': true } },
      { origin: `https://site-${variant}.example`, path: `/find_${variant}`, method: 'POST', success: { 'meta.ok': true } },
    ];
    const traces = ['top', 'blue'].map(query => ({ input: { [argument]: query }, calls: [
      { ...policy[0], encoding: 'query', params: {}, status: 200, response: wrap(records) },
      { ...policy[1], encoding: 'json', params: { needle: query }, status: 200, response: wrap(filter(query)) },
    ] }));
    const recipe = compileReadWorkflow({ id: `search_variant_${variant}`, traces, approvedRequests: policy });
    handleRequest = async (url, options) => Response.json(wrap(String(url).endsWith(`/list_${variant}`) ? records : filter(JSON.parse(options.body).needle)));
    const run = createReadWorkflowRunner(recipe, policy);
    for (const query of ['shirt', 'dress', 'SHIRT', 'absent']) {
      assert.deepEqual((await run({ [argument]: query })).data.payload[collection], filter(query));
    }
  }
});
