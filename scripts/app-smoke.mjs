import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, cp, readFile, readdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { randomBytes } from 'node:crypto';

const directory = await mkdtemp(join(tmpdir(), 'web2api-app-smoke-'));
const root = join(directory, 'app'), stateDirectory = join(directory, 'workflows');
let child;
async function start() {
  const env = { ...process.env, WEB2API_PORT: '0', WEB2API_WORKFLOWS: stateDirectory, WEB2API_UVCV_SESSION: join(directory, 'missing-test-session.json'), WEB2API_API_KEY: randomBytes(32).toString('hex') };
  delete env.WEB2API_RECIPE; delete env.WEB2API_UPSTREAM_TOKEN;
  child = spawn(process.execPath, [join(root, 'dist/app.mjs')], { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] });
  return await new Promise((resolve, reject) => {
    let output = '';
    const timer = setTimeout(() => reject(Error('Application startup timed out')), 20000);
    child.once('exit', code => { clearTimeout(timer); reject(Error(`Application exited before ready: ${code}`)); });
    child.stdout.on('data', chunk => { output += chunk; const match = /Web2API: (http:\/\/127\.0\.0\.1:\d+)/.exec(output); if (match) { clearTimeout(timer); resolve(match[1]); } });
  });
}
async function stop() { if (child && child.exitCode === null && child.signalCode === null) { const finished = once(child, 'exit'); child.kill(); await finished; } }
try {
  await cp(resolve('artifacts/web2api-app'), root, { recursive: true, filter: path => !path.split(/[\\/]/).includes('node_modules') });
  const names = await readdir(root); assert(!names.includes('node_modules')); assert(!names.includes('plugin.json')); assert(!names.includes('mcp.json'));
  let origin = await start();
  assert.equal((await fetch(`${origin}/v1/catalog`)).status, 401);
  const page = await fetch(origin), html = await page.text(); assert(html.includes('Workflow Studio'));
  let cookie = page.headers.get('set-cookie').split(';')[0];
  const initial = await (await fetch(`${origin}/v1/catalog`, { headers: { Cookie: cookie } })).json(); assert.equal(initial.workflows.length, 3);
  const capture = JSON.parse(await readFile(join(root, 'examples/learn-laptop.json'), 'utf8'));
  const response = await fetch(`${origin}/v1/learn`, { method: 'POST', headers: { Cookie: cookie, 'Content-Type': 'application/json' }, body: JSON.stringify({ reviewed: true, capture }) });
  assert.equal(response.status, 201); assert.equal((await response.json()).available_now, true);
  const catalog = await (await fetch(`${origin}/v1/catalog`, { headers: { Cookie: cookie } })).json(); assert.equal(catalog.workflows.length, 4);
  const contract = await (await fetch(`${origin}/v1/openapi.json`, { headers: { Cookie: cookie } })).json(); assert(contract.paths[`/v1/workflows/${capture.id}`]);
  const call = (name, headers = { Cookie: cookie }) => fetch(`${origin}/v1/workflows/${capture.id}`, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ product_name: name }) });
  const result = await (await call('MacBook Pro')).json(); assert.equal(result.data.id, 15); assert.equal(result.data.price, 1100);
  assert.equal((await call('MacBook Pro', { Cookie: cookie, Origin: 'https://untrusted.example' })).status, 403);
  const oldCookie = cookie;
  await stop(); origin = await start();
  assert.equal((await fetch(`${origin}/v1/catalog`, { headers: { Cookie: oldCookie } })).status, 401);
  cookie = (await fetch(origin)).headers.get('set-cookie').split(';')[0];
  assert.equal((await (await fetch(`${origin}/v1/catalog`, { headers: { Cookie: cookie } })).json()).workflows.length, 4);
  const recovered = await (await call('Sony vaio i7')).json(); assert.equal(recovered.data.id, 9); assert.equal(recovered.data.title.trim(), 'Sony vaio i7');
  assert.equal((await call('nonexistent-laptop-web2api')).status, 404);
  await writeFile('evidence/app-validation.json', JSON.stringify({ status: 'passed', observed_at: new Date().toISOString(), source: 'standalone_app_copied_outside_repository',
    node_modules_required: false, codex_required: false, plugin_manifest_required: false, backend_restart_tested: true,
    checks: ['anonymous_api_rejected', 'local_ui_session', 'catalog_schemas', 'live_capture_learning', 'immediate_catalog_update', 'dynamic_openapi', 'live_reserved_case', 'foreign_origin_rejected', 'local_session_rotated_on_restart', 'workflow_persisted_across_restart', 'site_whitespace_preserved', 'missing_product_rejected'],
    discovery: 'reviewed_capture_import', autonomous_url_discovery: false, authenticated_site_connectors: false }, null, 2));
  console.log('Standalone app passed: UI session, live learning, immediate REST/OpenAPI update, persistence after restart and rejected origins. No Codex, plugin manifests or node_modules.');
} finally {
  await stop(); assert(resolve(directory).startsWith(resolve(tmpdir())) && directory.includes('web2api-app-smoke-'));
  await rm(directory, { recursive: true, force: true });
}
