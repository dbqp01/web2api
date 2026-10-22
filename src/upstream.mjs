import { WorkflowError } from './contracts.mjs';
import { readJson } from './http.mjs';

export async function upstreamJson(url, init = {}, { allowJsonText = false } = {}) {
  try {
    const response = await fetch(url, { ...init, redirect: 'manual', signal: AbortSignal.timeout(8000) });
    if (response.status === 401 || response.status === 403) throw new WorkflowError('AUTH_EXPIRED', 401);
    if (response.status === 429) throw new WorkflowError('RATE_LIMITED', 429);
    if (response.status === 404) throw new WorkflowError('UPSTREAM_CHANGED');
    if (response.status === 409) throw new WorkflowError('UPSTREAM_CONFLICT', 409);
    const type = response.headers.get('content-type') || '';
    if (!response.ok || !(type.includes('application/json') || (allowJsonText && type.includes('text/html')))) throw new WorkflowError('UPSTREAM_UNAVAILABLE');
    try { return await readJson(response.body, 262144); }
    catch (error) {
      if (error.name === 'TimeoutError' || error.name === 'AbortError') throw error;
      throw new WorkflowError('UPSTREAM_CHANGED');
    }
  } catch (error) {
    if (error instanceof WorkflowError) throw error;
    throw new WorkflowError(['TimeoutError', 'AbortError'].includes(error.name) ? 'UPSTREAM_TIMEOUT' : 'UPSTREAM_UNAVAILABLE');
  }
}
