import { WorkflowError } from './contracts.mjs';

export async function readJson(stream, limit = 65536) {
  const chunks = []; let size = 0;
  for await (const chunk of stream) {
    size += chunk.length;
    if (size > limit) throw new WorkflowError('BODY_TOO_LARGE', 413);
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw new WorkflowError('INVALID_JSON', 400); }
}

export function json(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  res.end(JSON.stringify(body));
}

export function errorResponse(res, error) {
  if (!res.headersSent) json(res, error instanceof WorkflowError ? error.status : 500, { error: { code: error instanceof WorkflowError ? error.code : 'INTERNAL_ERROR' } });
  else res.destroy();
}

export async function listen(server, port = 0) {
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
  const origin = `http://127.0.0.1:${server.address().port}`;
  return { origin, close: () => new Promise((resolve, reject) => { server.close(error => error ? reject(error) : resolve()); server.closeAllConnections(); }) };
}

export function validHost(req) {
  if (!/^127\.0\.0\.1:\d+$/.test(req.headers.host || '')) throw new WorkflowError('HOST_REJECTED', 403);
  if (req.headers.origin && req.headers.origin !== `http://${req.headers.host}`) throw new WorkflowError('ORIGIN_REJECTED', 403);
}
