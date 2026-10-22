import { fork } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { parse, WorkflowError } from './contracts.mjs';
import { readPolicySchema } from './read-workflow.mjs';
import { sitePolicies } from './site-policies.mjs';

export const discoveryRequestSchema = z.object({ url: z.url().max(2000), task: z.literal('product_lookup'),
  id: z.string().regex(/^[a-z][a-z0-9_]{1,79}$/), category: z.string().trim().min(1).max(80).optional(),
  reviewed_requests: z.array(readPolicySchema).max(8).default([]), reviewed: z.boolean().default(false),
}).strict();

export function createDiscoveryJobs({ publish, workerPath = fileURLToPath(new URL('../dist/discover.mjs', import.meta.url)) }) {
  const jobs = new Map(); let active;
  const get = id => { if (!jobs.has(id)) throw new WorkflowError('NOT_FOUND', 404); return jobs.get(id); };
  return {
    get,
    start(raw) {
      const request = parse(discoveryRequestSchema, raw);
      const target = new URL(request.url);
      if (target.protocol !== 'https:' || target.username || target.password || target.hash || [...target.searchParams.keys()].some(key => /token|cookie|secret|password|authorization/i.test(key))) throw new WorkflowError('ORIGIN_REJECTED', 400);
      if (request.reviewed_requests.length && !request.reviewed) throw new WorkflowError('OPERATION_REVIEW_REQUIRED', 403);
      if (active) throw new WorkflowError('DISCOVERY_BUSY', 409);
      while (jobs.size >= 10) jobs.delete(jobs.keys().next().value);
      const goal = 'Consultar la ficha de un producto por nombre exacto';
      const job = { id: randomUUID(), status: 'running', goal, task: request.task, target: target.origin, started_at: new Date().toISOString(), events: [] };
      jobs.set(job.id, job);
      const child = fork(workerPath, [], { stdio: ['ignore', 'ignore', 'pipe', 'ipc'], windowsHide: true }); active = child;
      const finish = () => { clearTimeout(timer); if (active === child) active = null; };
      const fail = code => { if (!['running', 'evaluating'].includes(job.status)) return; job.status = 'failed'; job.error = code; job.finished_at = new Date().toISOString(); finish(); };
      const timer = setTimeout(() => { fail('DISCOVERY_TIMEOUT'); child.kill(); }, 120000);
      child.on('error', () => fail('DISCOVERY_WORKER_UNAVAILABLE'));
      child.on('exit', () => { if (job.status === 'running') fail('DISCOVERY_WORKER_STOPPED'); });
      child.on('message', async message => {
        if (job.status !== 'running') return;
        if (message.type === 'progress') {
          if (job.events.length < 20) job.events.push({ stage: message.stage, detail: message.detail, observed_at: new Date().toISOString() });
        } else if (message.type === 'error') { job.blocked_operations = message.blocked_operations; fail(message.code); }
        else if (message.type === 'result') {
          clearTimeout(timer); job.status = 'evaluating';
          // Discovery is finished before replay. Evaluation uses only HTTP and the reserved input.
          job.events.push({ stage: 'http_evaluation', detail: 'Browser closed; compiling and replaying the independent HTTP workflow.', observed_at: new Date().toISOString() });
          try {
            const result = await publish(message.capture);
            job.status = 'verified'; job.workflow = result.workflow; job.verification = result.verification; job.discovery = message.discovery;
            job.cases = [...message.capture.training, ...message.capture.evaluation].map((trace, index) => ({ input: trace.input, role: index < 2 ? 'training' : 'held_out', visual: trace.visual }));
            job.finished_at = new Date().toISOString(); finish();
          } catch (error) { fail(error instanceof WorkflowError ? error.code : 'EVALUATION_FAILED'); }
        }
      });
      child.send({ ...request, goal, readPolicies: [...Object.values(sitePolicies).flatMap(policy => policy.approvedRequests), ...request.reviewed_requests] });
      return { id: job.id, status: job.status };
    },
    close() { if (active) { active.kill(); active = null; } },
  };
}
