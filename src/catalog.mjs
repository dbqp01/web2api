import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { inputs, parse, recipeSchema, WorkflowError } from './contracts.mjs';
import { createRunner } from './runner.mjs';
import { createUsgarRunner, usgarDefinitions } from './usgar.mjs';
import { descriptions } from './contracts.mjs';
import { loadExternalWorkflows, loadLearnedWorkflows } from './external-workflows.mjs';
import { createUvcvRunner, uvcvDefinitions, uvcvSessionAvailable } from './uvcv.mjs';

export const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');

export async function loadUvcvCatalog() {
  if (!uvcvSessionAvailable()) throw new WorkflowError('SESSION_NOT_CONFIGURED', 401);
  const source = await readFile(new URL('../src/uvcv.mjs', import.meta.url), 'utf8');
  let report;
  try { report = JSON.parse(await readFile(new URL('../evidence/uvcv-validation.json', import.meta.url), 'utf8')); }
  catch { throw new WorkflowError('CATALOG_NOT_VERIFIED'); }
  if (report.status !== 'passed' || report.adapter_hash !== digest(source)) throw new WorkflowError('CATALOG_NOT_VERIFIED');
  return { definitions: uvcvDefinitions, run: createUvcvRunner(), scope: 'uvcv_authenticated_read_only' };
}
export async function loadRuntime() {
  const path = resolve(process.env.WEB2API_RECIPE || '.local/recipe.json');
  const recipe = parse(recipeSchema, JSON.parse(await readFile(path, 'utf8')), 'INVALID_RECIPE');
  const report = JSON.parse(await readFile(`${path}.verification.json`, 'utf8'));
  if (report.recipe_hash !== digest(recipe) || report.status !== 'passed' ||
      !Object.keys(inputs).every(name => report.accepted_workflows?.includes(name))) throw new WorkflowError('CATALOG_NOT_VERIFIED');
  return createRunner({ recipe, origin: process.env.WEB2API_ORIGIN || 'http://127.0.0.1:4318', token: process.env.WEB2API_UPSTREAM_TOKEN });
}

export async function loadCatalog({ workflowsDirectory = process.env.WEB2API_WORKFLOWS } = {}) {
  if (process.env.WEB2API_RECIPE) return {
    definitions: Object.fromEntries(Object.keys(inputs).map(name => [name, { input: inputs[name], description: descriptions[name], effect: name === 'add_to_cart' ? 'write' : 'read' }])),
    run: await loadRuntime(), scope: 'controlled_lab_only',
  };
  const source = await readFile(new URL('../src/usgar.mjs', import.meta.url), 'utf8');
  const report = JSON.parse(await readFile(new URL('../evidence/usgar-validation.json', import.meta.url), 'utf8'));
  if (report.status !== 'passed' || report.adapter_hash !== digest(source)) throw new WorkflowError('CATALOG_NOT_VERIFIED');
  const external = await loadExternalWorkflows(), runUsgar = createUsgarRunner();
  const uvcv = uvcvSessionAvailable() ? await loadUvcvCatalog() : { definitions: {}, run: null };
  const definitions = { ...usgarDefinitions, ...external.definitions, ...uvcv.definitions };
  const learned = await loadLearnedWorkflows(workflowsDirectory);
  if (Object.keys(learned.definitions).some(id => Object.hasOwn(definitions, id))) throw new WorkflowError('DUPLICATE_WORKFLOW');
  return { definitions: { ...definitions, ...learned.definitions }, run: (name, input) => Object.hasOwn(usgarDefinitions, name) ? runUsgar(name, input) : Object.hasOwn(external.definitions, name) ? external.run(name, input) : Object.hasOwn(uvcv.definitions, name) ? uvcv.run(name, input) : learned.run(name, input), scope: uvcv.run ? 'verified_reads' : 'verified_public_reads' };
}
