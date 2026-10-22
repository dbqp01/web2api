import test from 'node:test';
import assert from 'node:assert/strict';
import { createUsgarRunner } from '../src/usgar.mjs';

const query = { check_in: '2099-11-01', check_out: '2099-11-03', guests: 2 };
const room = { id_room_type: 1, slug: 'test-room', room_name: 'Test room', price: 65, non_refundable_price: 58.5, max_guests: 3, total_rooms: 4, available_qty: 2, currency: 'USD', nights: 2, total_stay_price: 130 };
const calendar = { success: true, from: '2099-11-01', to: '2099-11-02', days: { '2099-11-01': { 'test-room': 3 }, '2099-11-02': { 'test-room': 2 } } };

test('USGAR filters occupancy, keeps exact price units and verifies every stay night', async t => {
  const urls = [];
  t.mock.method(globalThis, 'fetch', async url => {
    urls.push(new URL(url));
    return Response.json(new URL(url).pathname.endsWith('calendar') ? calendar : { success: true, rooms: [room] });
  });
  const run = createUsgarRunner();
  const result = await run('search_usgar_rooms', query);
  assert.equal(result.data.rooms[0].non_refundable_stay_cents, 11700);
  assert.equal(result.data.rooms[0].standard_stay_cents, 13000);
  assert.equal(result.data.availability_confirmed, false);
  assert.equal(urls[0].searchParams.get('checkIn'), query.check_in);
  assert.equal(urls[1].searchParams.get('to'), '2099-11-02');
  assert.deepEqual((await run('search_usgar_rooms', { ...query, guests: 8 })).data.rooms, []);
});

test('USGAR rejects invented inventory, ignored dates and malformed dates', async t => {
  let broken = { ...room, available_qty: 3 };
  t.mock.method(globalThis, 'fetch', async url => Response.json(new URL(url).pathname.endsWith('calendar') ? calendar : { success: true, rooms: [broken] }));
  await assert.rejects(createUsgarRunner()('search_usgar_rooms', query), e => e.code === 'INVENTORY_UNVERIFIED');
  broken = { ...room, nights: 1 };
  await assert.rejects(createUsgarRunner()('search_usgar_rooms', query), e => e.code === 'INVENTORY_UNVERIFIED');
  await assert.rejects(createUsgarRunner()('search_usgar_rooms', { ...query, check_in: '2099-02-30' }), e => e.code === 'INVALID_INPUT');
  await assert.rejects(createUsgarRunner()('search_usgar_rooms', { ...query, check_out: query.check_in }), e => e.code === 'INVALID_INPUT');
  await assert.rejects(createUsgarRunner()('search_usgar_rooms', { ...query, guests: 0 }), e => e.code === 'INVALID_INPUT');
});

test('USGAR stops on rate limits and refuses redirects and HTML responses', async t => {
  let status = 429, calls = 0;
  t.mock.method(globalThis, 'fetch', async () => { calls++; return new Response('untrusted details', { status, headers: { Location: 'https://other.example/' } }); });
  await assert.rejects(createUsgarRunner()('search_usgar_rooms', query), e => e.code === 'RATE_LIMITED');
  assert.equal(calls, 1);
  status = 302;
  await assert.rejects(createUsgarRunner()('search_usgar_rooms', query), e => e.code === 'UPSTREAM_UNAVAILABLE');
  status = 200;
  await assert.rejects(createUsgarRunner()('search_usgar_rooms', query), e => e.code === 'UPSTREAM_UNAVAILABLE');
});
