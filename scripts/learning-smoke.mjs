import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, cp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const directory = await mkdtemp(join(tmpdir(), 'web2api-learning-smoke-'));
const root = join(directory, 'plugin'), workflows = join(directory, 'workflows');
const capture = resolve('examples/learn-laptop.json');
const request = JSON.parse(await readFile(capture, 'utf8'));
const client = new Client({ name: 'web2api-learned-smoke', version: '1.0.0' });
try {
  await cp(resolve(process.argv[2] || 'artifacts/plugin/web2api'), root, { recursive: true });
  const cleanEnv = { ...process.env }; delete cleanEnv.WEB2API_RECIPE; delete cleanEnv.WEB2API_UPSTREAM_TOKEN; delete cleanEnv.WEB2API_WORKFLOWS;
  // Run the packaged learner and MCP outside the repository, without npm or browser.
  await promisify(execFile)(process.execPath, [join(root, 'dist/learn.mjs'), capture, workflows], { cwd: root, env: cleanEnv });
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [join(root, 'dist/mcp.mjs')], cwd: root, env: { ...cleanEnv, WEB2API_WORKFLOWS: workflows } }));
  const tools = (await client.listTools()).tools;
  assert.equal(tools.length, 4);
  assert(tools.some(tool => tool.name === request.id && tool.inputSchema && tool.outputSchema && tool.annotations.readOnlyHint));
  const cases = [];
  for (const trace of [...request.training, ...request.evaluation]) {
    const result = await client.callTool({ name: request.id, arguments: trace.input });
    assert.notEqual(result.isError, true);
    assert.deepEqual(result.structuredContent.data, trace.calls.at(-1).response);
    cases.push({ input: trace.input, role: request.evaluation.includes(trace) ? 'held_out_input' : 'training_replay', status: 'passed', id: result.structuredContent.data.id, visual: trace.visual });
  }
  const missing = await client.callTool({ name: request.id, arguments: { product_name: 'nonexistent-laptop-web2api' } });
  assert.equal(missing.isError, true);
  assert.equal(JSON.parse(missing.content[0].text).error.code, 'NO_MATCH');
  await writeFile('evidence/learning-validation.json', JSON.stringify({ status: 'passed', observed_at: new Date().toISOString(), workflow: request.id,
    source_mode: 'observed_first_party_http', discovery: 'agent_assisted_browser_capture', autonomous_discovery: false, site_specific_code_added: false,
    general_engine_fix_found_during_discovery: 'trim_name_selection',
    packaged_learner: true, packaged_mcp: true, node_modules_required: false, tools_exposed: tools.map(tool => tool.name), cases,
    negative_cases: ['missing_product'], capture_path: 'examples/learn-laptop.json', screenshot: 'assets/validation/learned-laptop.png' }, null, 2));
  console.log('Packaged learner → independent evaluation → new typed MCP tool: three live product cases and missing-product rejection passed.');
} finally {
  await client.close();
  assert(resolve(directory).startsWith(resolve(tmpdir())) && directory.includes('web2api-learning-smoke-'));
  await rm(directory, { recursive: true, force: true });
}
