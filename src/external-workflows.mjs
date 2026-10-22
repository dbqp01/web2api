import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { sitePolicies } from './site-policies.mjs';
import { createReadWorkflowRunner, readWorkflowInput, readWorkflowOutput, readRecipeSchema } from './read-workflow.mjs';
import { parse, WorkflowError } from './contracts.mjs';
import { readEngineHash, validateLearnedWorkflow } from './learning.mjs';

const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export async function loadExternalWorkflows() {
  const report = JSON.parse(await readFile(new URL('../evidence/multisite-validation.json', import.meta.url), 'utf8'));
  const visual = JSON.parse(await readFile(new URL('../evidence/multisite-visual-review.json', import.meta.url), 'utf8'));
  const cases = Object.fromEntries(Object.entries(report.sites ?? {}).map(([site, result]) => [site, result.cases.map(c => ({ input: c.input, visual: c.visual }))]));
  if (visual.status !== 'passed_with_limits' || visual.case_hash !== digest(cases)) throw new WorkflowError('VISUAL_REVIEW_REQUIRED');
  if (report.status !== 'passed' || report.engine_hash !== digest(await readFile(new URL('../src/read-workflow.mjs', import.meta.url), 'utf8')) ||
      report.policy_hash !== digest(await readFile(new URL('../src/site-policies.mjs', import.meta.url), 'utf8'))) throw new WorkflowError('CATALOG_NOT_VERIFIED');
  const definitions = {}, runners = {};
  for (const [site, policy] of Object.entries(sitePolicies)) {
    const recipe = parse(readRecipeSchema, JSON.parse(await readFile(new URL(`../recipes/${site}.json`, import.meta.url), 'utf8')), 'INVALID_RECIPE');
    if (recipe.id !== policy.workflow || report.sites[site]?.status !== 'passed' || report.sites[site].recipe_hash !== digest(recipe) || report.sites[site].held_out_cases < 1) throw new WorkflowError('CATALOG_NOT_VERIFIED');
    definitions[recipe.id] = { input: readWorkflowInput(recipe), output: readWorkflowOutput(recipe), effect: 'read', description: policy.description };
    runners[recipe.id] = createReadWorkflowRunner(recipe, policy.approvedRequests);
  }
  return { definitions, run(name, input) { if (!Object.hasOwn(runners, name)) throw new WorkflowError('UNKNOWN_WORKFLOW', 404); return runners[name](input); } };
}

export async function loadLearnedWorkflows(directory) {
  const definitions = {}, runners = {};
  if (directory) {
    const files = (await readdir(directory, { withFileTypes: true })).filter(file => file.isFile() && file.name.endsWith('.workflow.json'));
    if (files.length > 20) throw new WorkflowError('INVALID_WORKFLOW_DIRECTORY');
    const engineHash = await readEngineHash();
    for (const file of files) {
      const text = await readFile(join(directory, file.name), 'utf8');
      if (Buffer.byteLength(text) > 1048576) throw new WorkflowError('INVALID_LEARNED_WORKFLOW');
      const bundle = validateLearnedWorkflow(JSON.parse(text), engineHash), recipe = bundle.recipe;
      if (Object.hasOwn(definitions, recipe.id)) throw new WorkflowError('DUPLICATE_WORKFLOW');
      runners[recipe.id] = createReadWorkflowRunner(recipe, bundle.approved_requests);
      definitions[recipe.id] = { input: readWorkflowInput(recipe), output: readWorkflowOutput(recipe), effect: 'read', description: bundle.description };
    }
  }
  return { definitions, run(name, input) { if (!Object.hasOwn(runners, name)) throw new WorkflowError('UNKNOWN_WORKFLOW', 404); return runners[name](input); } };
}
