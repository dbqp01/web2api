import { randomBytes } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { homedir } from 'node:os';
import { z } from 'zod';
import { createApi } from './api.mjs';
import { loadCatalog } from './catalog.mjs';
import { learnReadWorkflow } from './learning.mjs';
import { createReadWorkflowRunner, readWorkflowInput, readWorkflowOutput } from './read-workflow.mjs';
import { listen } from './http.mjs';
import { WorkflowError, parse } from './contracts.mjs';
import { createDiscoveryJobs } from './discovery-jobs.mjs';

const defaultStateDirectory = join(process.env.LOCALAPPDATA || join(homedir(), '.local/share'), 'Web2API', 'workflows');
export async function createApp({ stateDirectory = defaultStateDirectory, apiKey = randomBytes(32).toString('hex'), catalog } = {}) {
  await mkdir(stateDirectory, { recursive: true });
  catalog ??= await loadCatalog({ workflowsDirectory: stateDirectory });
  const definitions = { ...catalog.definitions }, runners = {}, ui = {};
  for (const [path, file, type] of [['/', 'index.html', 'text/html; charset=utf-8'], ['/app.js', 'app.js', 'text/javascript; charset=utf-8'], ['/style.css', 'style.css', 'text/css; charset=utf-8']]) {
    ui[path] = { type, body: await readFile(new URL(`../web/${file}`, import.meta.url)) };
  }
  ui['/examples/learn-laptop.json'] = { type: 'application/json', body: await readFile(new URL('../examples/learn-laptop.json', import.meta.url)) };
  let learning = false;
  async function learn(request) {
      if (learning) throw new WorkflowError('WORKFLOW_BUSY', 409);
      if (request && Object.hasOwn(definitions, request.id)) throw new WorkflowError('DUPLICATE_WORKFLOW', 409);
      learning = true;
      try {
        const bundle = await learnReadWorkflow(request), recipe = bundle.recipe;
        const run = createReadWorkflowRunner(recipe, bundle.approved_requests);
        try { await writeFile(join(stateDirectory, `${recipe.id}.workflow.json`), JSON.stringify(bundle, null, 2), { flag: 'wx' }); }
        catch (error) { if (error.code === 'EEXIST') throw new WorkflowError('DUPLICATE_WORKFLOW', 409); throw error; }
        runners[recipe.id] = run;
        definitions[recipe.id] = { input: readWorkflowInput(recipe), output: readWorkflowOutput(recipe), effect: 'read', description: bundle.description };
        return { workflow: recipe.id, verification: bundle.verification, available_now: true };
      } finally { learning = false; }
  }
  const discovery = createDiscoveryJobs({ publish: learn });
  const server = createApi({ definitions, apiKey, ui, scope: catalog.scope ?? 'verified_public_reads', learn, discovery,
    run: (name, input) => Object.hasOwn(runners, name) ? runners[name](input) : catalog.run(name, input) });
  server.once('close', () => discovery.close());
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const server = await createApp({ stateDirectory: process.env.WEB2API_WORKFLOWS ? resolve(process.env.WEB2API_WORKFLOWS) : defaultStateDirectory, apiKey: process.env.WEB2API_API_KEY });
    const port = parse(z.coerce.number().int().min(0).max(65535), process.env.WEB2API_PORT ?? 4319, 'INVALID_PORT');
    const running = await listen(server, port);
    console.log(`Web2API: ${running.origin}`);
    const stop = async () => { await running.close(); process.exitCode = 0; };
    process.once('SIGINT', stop); process.once('SIGTERM', stop);
  } catch { console.error('Web2API cannot start. Check port 4319, saved workflows and release evidence.'); process.exitCode = 1; }
}
