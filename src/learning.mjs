import { z } from 'zod';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { isDeepStrictEqual } from 'node:util';
import { parse, WorkflowError } from './contracts.mjs';
import { compileReadWorkflow, createReadWorkflowRunner, readRecipeSchema, readPolicySchema } from './read-workflow.mjs';

const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const demonstration = z.object({ input: z.record(z.string(), z.string()), calls: z.array(z.object({
  origin: z.url(), path: z.string(), method: z.enum(['GET', 'POST']), encoding: z.enum(['query', 'form', 'json']),
  params: z.record(z.string(), z.union([z.string().max(1000), z.number().finite(), z.boolean(), z.null()])), status: z.number().int(),
  response: z.unknown().refine(value => value !== undefined),
}).passthrough()).min(1).max(8) }).passthrough();
export const learningCaptureSchema = z.object({ id: z.string().regex(/^[a-z][a-z0-9_]{1,79}$/), description: z.string().min(10).max(1000), effect: z.literal('read'),
  source_mode: z.enum(['observed_first_party_http', 'documented_api']), approved_requests: z.array(readPolicySchema).min(1).max(8),
  training: z.array(demonstration).min(2).max(20), evaluation: z.array(demonstration).min(1).max(50),
}).strict();
export const learnedWorkflowSchema = z.object({
  version: z.literal(1), effect: z.literal('read'), description: z.string().min(10).max(1000),
  recipe: readRecipeSchema, approved_requests: z.array(readPolicySchema).min(1).max(8),
  verification: z.object({ status: z.literal('passed'), mode: z.literal('live_http_replay'), engine_hash: hash, recipe_hash: hash, policy_hash: hash,
    evaluated_at: z.iso.datetime(), training_cases: z.number().int().min(2), held_out_inputs: z.array(z.record(z.string(), z.string())).min(1).max(50) }).strict(),
}).strict();
export async function readEngineHash() {
  return digest(await readFile(new URL('../src/read-workflow.mjs', import.meta.url), 'utf8'));
}

export function validateLearnedWorkflow(raw, engineHash) {
  const bundle = parse(learnedWorkflowSchema, raw, 'INVALID_LEARNED_WORKFLOW');
  const report = bundle.verification;
  if (report.engine_hash !== engineHash || report.recipe_hash !== digest(bundle.recipe) || report.policy_hash !== digest(bundle.approved_requests)) throw new WorkflowError('CATALOG_NOT_VERIFIED');
  return bundle;
}

export async function learnReadWorkflow(raw) {
  if (raw?.effect !== 'read') throw new WorkflowError('UNREVIEWED_OPERATION');
  const { id, description, source_mode, approved_requests, training, evaluation } = parse(learningCaptureSchema, raw);
  const policy = parse(z.array(readPolicySchema).min(1).max(8), approved_requests, 'UNREVIEWED_OPERATION');
  if (!Array.isArray(training) || !Array.isArray(evaluation) || !evaluation.length || evaluation.length > 50 ||
      evaluation.some(trace => training.some(seen => isDeepStrictEqual(seen.input, trace.input)))) throw new WorkflowError('HELD_OUT_INPUT_REQUIRED');
  const recipe = compileReadWorkflow({ id, traces: training, approvedRequests: policy, sourceMode: source_mode });
  const run = createReadWorkflowRunner(recipe, policy);
  // Keep evaluation traces out of compilation; their observed outputs are an independent oracle.
  for (const trace of [...training, ...evaluation]) {
    const actual = await run(trace.input);
    if (!isDeepStrictEqual(actual.data, trace.calls?.at(-1)?.response)) throw new WorkflowError('EVALUATION_MISMATCH');
  }
  const bundle = { version: 1, effect: 'read', description, recipe, approved_requests: policy,
    verification: { status: 'passed', mode: 'live_http_replay', engine_hash: await readEngineHash(), recipe_hash: digest(recipe), policy_hash: digest(policy),
      evaluated_at: new Date().toISOString(), training_cases: training.length, held_out_inputs: evaluation.map(trace => trace.input) } };
  return validateLearnedWorkflow(bundle, bundle.verification.engine_hash);
}
