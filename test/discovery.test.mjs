import test from 'node:test';
import assert from 'node:assert/strict';
import { chooseCatalog, chooseDetail } from '../src/discovery.mjs';
import { isPublicAddress } from '../src/network-boundary.mjs';
import { createDiscoveryJobs } from '../src/discovery-jobs.mjs';

test('discovery pairs unknown JSON fields with visible links and requires a second visible field', () => {
  const rows = ['Copper kettle', 'Glass jug', 'Steel cup'].map((label, index) => ({ ref: index + 71, caption: label, amount: (index + 3) * 100 }));
  const calls = [{ response: { envelope: { stock: rows } } }];
  const links = rows.map(row => ({ text: row.caption, href: `https://store.example/item?opaque=${row.ref}` }));
  assert.equal(chooseCatalog(calls, links).collection, 'envelope.stock');
  assert.throws(() => chooseCatalog(calls, []), error => error.code === 'CATALOG_NOT_DISCOVERED');
  assert.throws(() => chooseDetail([{ response: rows[0] }], rows[0], 'Copper kettle', 'Copper kettle'), error => error.code === 'DETAIL_API_NOT_DISCOVERED');
  assert.equal(chooseDetail([{ response: rows[0] }], rows[0], 'Copper kettle Price: 300', 'Copper kettle').call.response.ref, 71);
  assert.throws(() => chooseDetail([{ response: { ...rows[0], amount: 999 } }], rows[0], 'Copper kettle Price: 999', 'Copper kettle'), error => error.code === 'DETAIL_API_NOT_DISCOVERED');
});

test('discovery rejects private and special network addresses and unsupported task contracts', () => {
  for (const address of ['127.0.0.1', '10.0.0.2', '192.168.1.1', '169.254.169.254', '172.20.0.1', '100.64.0.1', '198.18.0.1', '192.0.2.1', '198.51.100.1', '203.0.113.1', '::1', '::ffff:127.0.0.1', 'fd00::1', 'fe80::1', '2001:db8::1', '2002:7f00:1::']) assert.equal(isPublicAddress(address), false, address);
  for (const address of ['8.8.8.8', '1.1.1.1', '2606:4700:4700::1111']) assert.equal(isPublicAddress(address), true, address);
  const jobs = createDiscoveryJobs({ publish: async () => {} });
  assert.throws(() => jobs.start({ url: 'https://store.example', task: 'send_message', id: 'invalid_task' }), error => error.code === 'INVALID_INPUT');
  assert.throws(() => jobs.start({ url: 'http://127.0.0.1', task: 'product_lookup', id: 'invalid_origin' }), error => error.code === 'ORIGIN_REJECTED');
  assert.throws(() => jobs.start({ url: 'https://store.example', task: 'product_lookup', id: 'review_needed', reviewed_requests: [{ origin: 'https://store.example', path: '/query', method: 'POST' }] }), error => error.code === 'OPERATION_REVIEW_REQUIRED');
});
