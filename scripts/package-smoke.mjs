import assert from 'node:assert/strict';
import { resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import { readFile, writeFile, readdir, access, mkdtemp, cp, rm } from 'node:fs/promises';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { createApi } from '../src/api.mjs';
import { loadCatalog } from '../src/catalog.mjs';
import { listen } from '../src/http.mjs';
import { randomBytes } from 'node:crypto';

const temporary = process.argv[2] ? null : await mkdtemp(join(tmpdir(), 'web2api-package-'));
const root = temporary ? join(temporary, 'web2api') : resolve(process.argv[2]);
if (temporary) await cp(resolve('artifacts/plugin/web2api'), root, { recursive: true });
assert(!(await readdir(root)).includes('node_modules'));
const config = JSON.parse(await readFile(`${root}/mcp.json`, 'utf8')).mcpServers.web2api;
const args = config.args.map(a => a.replaceAll('${PLUGIN_ROOT}', root));
await access(args[0]);
const env = { ...process.env }; delete env.WEB2API_RECIPE; delete env.WEB2API_UPSTREAM_TOKEN; delete env.WEB2API_WORKFLOWS;
const client = new Client({ name: 'web2api-package-smoke', version: '0.1.0' });
try {
  await client.connect(new StdioClientTransport({ command: process.execPath, args, cwd: root, env }));
  const tools = (await client.listTools()).tools;
  assert.deepEqual(tools.map(t => t.name).sort(), ['lookup_demoblaze_phone', 'search_automation_products', 'search_usgar_rooms']);
  assert(tools.every(t => t.outputSchema));
  const today = new Date().toISOString().slice(0, 10);
  const day = n => new Date(Date.parse(today) + n * 86400000).toISOString().slice(0, 10);
  const result = await client.callTool({ name: 'search_usgar_rooms', arguments: { check_in: day(15), check_out: day(17), guests: 2 } });
  assert.equal(result.isError, undefined);
  assert(result.structuredContent.data.rooms.length > 0);
  assert.equal(result.structuredContent.evidence.transport, 'http_only');
  const phone = await client.callTool({ name: 'lookup_demoblaze_phone', arguments: { product_name: 'Nexus 6' } });
  assert.equal(phone.isError, undefined); assert.equal(phone.structuredContent.data.id, 3); assert.equal(phone.structuredContent.data.price, 650);
  const clothes = await client.callTool({ name: 'search_automation_products', arguments: { query: 'tshirt' } });
  assert.equal(clothes.isError, undefined); assert(clothes.structuredContent.data.products.some(p => p.name === 'Men Tshirt' && p.price === 'Rs. 400'));
  const absent = await client.callTool({ name: 'lookup_demoblaze_phone', arguments: { product_name: 'nonexistent-phone-web2api' } });
  assert.equal(absent.isError, true);
  const apiKey = randomBytes(32).toString('hex');
  const api = await listen(createApi({ ...await loadCatalog(), apiKey }));
  try {
    assert.equal((await fetch(`${api.origin}/v1/catalog`)).status, 401);
    const response = await fetch(`${api.origin}/v1/workflows/lookup_demoblaze_phone`, { method: 'POST', headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ product_name: 'Nexus 6' }) });
    assert.equal(response.status, 200); assert.equal((await response.json()).data.id, 3);
  } finally { await api.close(); }
  if (temporary) {
    const visualPath = `${root}/evidence/multisite-visual-review.json`;
    const visual = JSON.parse(await readFile(visualPath, 'utf8'));
    visual.status = 'review_required';
    await writeFile(visualPath, JSON.stringify(visual));
    const rejected = new Client({ name: 'unreviewed-package-control', version: '0.2.0' });
    try {
      await assert.rejects(rejected.connect(new StdioClientTransport({ command: process.execPath, args, cwd: root, env, stderr: 'pipe' })));
    } finally { await rejected.close(); }
  }
  console.log('Packaged MCP: three typed tools, live calls on all three sites, absent-product rejection, authenticated REST and anonymous rejection passed. No node_modules in package.');
} finally {
  await client.close();
  if (temporary) {
    assert(resolve(temporary).startsWith(resolve(tmpdir()) + '\\web2api-package-') || resolve(temporary).startsWith(resolve(tmpdir()) + '/web2api-package-'));
    await rm(temporary, { recursive: true, force: true });
  }
}
