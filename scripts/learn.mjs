import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { learnReadWorkflow } from '../src/learning.mjs';
import { WorkflowError } from '../src/contracts.mjs';

try {
  const [, , inputFile, directory] = process.argv;
  if (!inputFile || !directory) throw new WorkflowError('USAGE: node dist/learn.mjs <reviewed-capture.json> <workflow-directory>');
  const request = JSON.parse(await readFile(resolve(inputFile), 'utf8'));
  const bundle = await learnReadWorkflow(request);
  await mkdir(resolve(directory), { recursive: true });
  const output = join(resolve(directory), `${bundle.recipe.id}.workflow.json`);
  await writeFile(output, JSON.stringify(bundle, null, 2), { flag: 'wx' });
  console.log(JSON.stringify({ status: 'passed', workflow: bundle.recipe.id, output, held_out_cases: bundle.verification.held_out_inputs.length }));
} catch (error) {
  console.error(error instanceof WorkflowError ? error.code : error.code === 'EEXIST' ? 'OUTPUT_ALREADY_EXISTS' : 'LEARNING_FAILED');
  process.exitCode = 1;
}
