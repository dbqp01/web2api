import { createServer } from 'node:http';
import { timingSafeEqual, randomBytes } from 'node:crypto';
import { z } from 'zod';
import { inputs, descriptions, WorkflowError } from './contracts.mjs';
import { errorResponse, json, readJson, validHost } from './http.mjs';
import { createOpenApi } from './openapi.mjs';
import { connectionStatus } from './connections.mjs';

export function createApi({ run, apiKey, definitions = Object.fromEntries(Object.keys(inputs).map(id => [id, { input: inputs[id], effect: id === 'add_to_cart' ? 'write' : 'read', description: descriptions[id] }])), scope = 'controlled_lab_only', ui, learn, discovery }) {
  if (typeof apiKey !== 'string' || apiKey.length < 32) throw new WorkflowError('API_KEY_REQUIRED');
  const session = ui ? randomBytes(32).toString('hex') : null;
  const equal = (actual, expected) => { const a = Buffer.from(actual), b = Buffer.from(expected); return a.length === b.length && timingSafeEqual(a, b); };
  return createServer(async (req, res) => {
    try {
      validHost(req);
      const path = new URL(req.url, `http://${req.headers.host}`).pathname;
      if (ui && req.method === 'GET' && Object.hasOwn(ui, path)) {
        const file = ui[path];
        res.writeHead(200, { 'Content-Type': file.type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer',
          'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
          ...(path === '/' ? { 'Set-Cookie': `web2api_session=${session}; HttpOnly; SameSite=Strict; Path=/` } : {}) });
        res.end(file.body); return;
      }
      const cookie = (req.headers.cookie || '').split(';').map(part => part.trim()).find(part => part.startsWith('web2api_session='))?.slice('web2api_session='.length);
      const authorized = equal(req.headers.authorization || '', `Bearer ${apiKey}`) || (session && cookie && equal(cookie, session));
      if (!authorized) throw new WorkflowError('UNAUTHORIZED', 401);
      if (path === '/v1/connections' && req.method === 'GET') { json(res, 200, connectionStatus(definitions, scope)); return; }
      if (path === '/v1/discoveries' && req.method === 'POST' && discovery) {
        if (!req.headers['content-type']?.startsWith('application/json')) throw new WorkflowError('CONTENT_TYPE_REQUIRED', 415);
        json(res, 202, discovery.start(await readJson(req))); return;
      }
      const discoveryMatch = /^\/v1\/discoveries\/([a-f0-9-]{36})$/.exec(path);
      if (discoveryMatch && req.method === 'GET' && discovery) { json(res, 200, discovery.get(discoveryMatch[1])); return; }
      if (path === '/v1/openapi.json' && req.method === 'GET') { json(res, 200, createOpenApi(definitions, { learning: !!learn, discovery: !!discovery })); return; }
      if (path === '/v1/catalog' && req.method === 'GET') { json(res, 200, { scope, transport: 'http_only', workflows: Object.entries(definitions).map(([id, d]) => ({ id, effect: d.effect, description: d.description,
        ...(d.auth ? { auth: d.auth } : {}), ...(d.input ? { input_schema: z.toJSONSchema(d.input) } : {}), ...(d.output ? { output_schema: z.toJSONSchema(d.output) } : {}) })) }); return; }
      if (path === '/v1/learn' && req.method === 'POST' && learn) {
        if (!req.headers['content-type']?.startsWith('application/json')) throw new WorkflowError('CONTENT_TYPE_REQUIRED', 415);
        const body = await readJson(req, 1048576);
        if (body.reviewed !== true) throw new WorkflowError('OPERATION_REVIEW_REQUIRED', 403);
        json(res, 201, await learn(body.capture)); return;
      }
      const match = /^\/v1\/workflows\/([a-z][a-z0-9_]{1,79})$/.exec(path);
      if (!match || req.method !== 'POST') throw new WorkflowError('NOT_FOUND', 404);
      if (!req.headers['content-type']?.startsWith('application/json')) throw new WorkflowError('CONTENT_TYPE_REQUIRED', 415);
      json(res, 200, await run(match[1], await readJson(req)));
    } catch (error) { errorResponse(res, error); }
  });
}

