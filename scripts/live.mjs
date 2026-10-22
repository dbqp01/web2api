import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { randomBytes } from 'node:crypto';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { createUsgarRunner, usgarDefinitions } from '../src/usgar.mjs';
import { createApi } from '../src/api.mjs';
import { listen } from '../src/http.mjs';
import { digest } from '../src/catalog.mjs';

await mkdir('evidence', { recursive: true });
await mkdir('artifacts', { recursive: true });
const report = { status: 'failed', observed_at: new Date().toISOString(), scope: 'usgar_public_read_only', autonomous_discovery: false, source: 'live_public_website_network', created_bookings: 0, payments: 0, cases: [], checks: [] };
const run = createUsgarRunner();
const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Lima', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const day = offset => new Date(Date.parse(today) + offset * 86400000).toISOString().slice(0, 10);
const first = { check_in: day(15), check_out: day(17), guests: 2 };
const second = { check_in: day(18), check_out: day(21), guests: 4 };
try {
  for (const input of [first, second]) {
    const start = performance.now(), result = await run('search_usgar_rooms', input);
    assert.equal(result.data.nights, (Date.parse(input.check_out) - Date.parse(input.check_in)) / 86400000);
    assert(result.data.rooms.every(r => r.max_guests >= input.guests));
    assert.equal(result.evidence.transport, 'http_only');
    assert.equal(result.data.availability_confirmed, false);
    report.cases.push({ input, status: 'passed', duration_ms: performance.now() - start, result });
  }
  assert(report.cases[0].result.data.rooms.length > 0, 'Baseline returned no rooms; require a non-empty live baseline for this release.');
  const firstCommon = report.cases[0].result.data.rooms.find(r => report.cases[1].result.data.rooms.some(s => s.slug === r.slug));
  assert(firstCommon, 'Need an overlapping room to verify date parameter changes.');
  const secondCommon = report.cases[1].result.data.rooms.find(r => r.slug === firstCommon.slug);
  assert.equal(firstCommon.standard_stay_cents, firstCommon.standard_nightly_cents * 2);
  assert.equal(secondCommon.standard_stay_cents, secondCommon.standard_nightly_cents * 3);
  report.checks.push('two_date_ranges_change_nights_and_totals', 'occupancy_filter', 'separate_calendar_crosscheck', 'no_browser_during_replay');
  report.adapter_hash = digest(await readFile('src/usgar.mjs', 'utf8'));
  report.status = 'passed';
  await writeFile('evidence/usgar-validation.json', JSON.stringify(report, null, 2));
  const env = { ...process.env }; delete env.WEB2API_RECIPE; delete env.WEB2API_UPSTREAM_TOKEN;
  const client = new Client({ name: 'web2api-live-independent-consumer', version: '0.1.0' });
  try {
    await client.connect(new StdioClientTransport({ command: process.execPath, args: [resolve('src/mcp.mjs')], env }));
    assert((await client.listTools()).tools.some(t => t.name === 'search_usgar_rooms'));
    const result = await client.callTool({ name: 'search_usgar_rooms', arguments: first });
    assert.equal(result.isError, undefined); assert.equal(result.structuredContent.data.nights, 2);
    assert(result.structuredContent.data.rooms.length > 0);
    const invalid = await client.callTool({ name: 'search_usgar_rooms', arguments: { ...first, guests: 0 } });
    assert.equal(invalid.isError, true);
    report.checks.push('mcp_handshake_tools_list_live_read_and_rejected_input');
  } finally { await client.close(); }
  const apiKey = randomBytes(32).toString('hex');
  const api = await listen(createApi({ run, definitions: usgarDefinitions, scope: report.scope, apiKey }));
  try {
    assert.equal((await fetch(`${api.origin}/v1/catalog`)).status, 401);
    const response = await fetch(`${api.origin}/v1/workflows/search_usgar_rooms`, { method: 'POST', headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' }, body: JSON.stringify(second) });
    assert.equal(response.status, 200); assert.equal((await response.json()).data.nights, 3);
    report.checks.push('authenticated_rest_read_and_rejected_anonymous');
  } finally { await api.close(); }
  report.finished_at = new Date().toISOString();
} catch (error) { report.status = 'failed'; report.failure = { code: error.code || error.name, message: error.message }; throw error; }
finally {
  await writeFile('evidence/usgar-validation.json', JSON.stringify(report, null, 2));
  await writeFile('artifacts/usgar-live-report.json', JSON.stringify(report, null, 2));
}
console.log(JSON.stringify({ status: report.status, cases: report.cases.length, checks: report.checks, report: 'artifacts/usgar-live-report.json' }, null, 2));
