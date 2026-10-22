import { z } from 'zod';
import packageInfo from '../package.json' with { type: 'json' };
import { discoveryRequestSchema } from './discovery-jobs.mjs';

export function createOpenApi(definitions, { learning = false, discovery = false } = {}) {
  const paths = {};
  for (const [id, definition] of Object.entries(definitions)) paths[`/v1/workflows/${id}`] = {
    post: { operationId: id, description: definition.description, security: [{ bearerAuth: [] }, { localBrowserSession: [] }],
      requestBody: { required: true, content: { 'application/json': { schema: z.toJSONSchema(definition.input) } } },
      responses: { 200: { description: 'Workflow result with source evidence and explicit limits.', ...(definition.output ? { content: { 'application/json': { schema: z.toJSONSchema(definition.output) } } } : {}) },
        400: { description: 'Invalid input' }, 401: { description: 'Unauthorized or session expired' }, 404: { description: 'No match or unknown workflow' }, 429: { description: 'Rate limited; no automatic retry' }, 502: { description: 'Upstream changed, rejected or inconsistent' } },
    },
  };
  paths['/v1/catalog'] = { get: { operationId: 'catalog', security: [{ bearerAuth: [] }, { localBrowserSession: [] }], responses: { 200: { description: 'Current workflow catalog, including typed inputs and outputs' }, 401: { description: 'Unauthorized' } } } };
  if (learning) paths['/v1/learn'] = { post: { operationId: 'learn_workflow', description: 'Validate a reviewed read-only capture against independent evaluation inputs, persist it and update the live catalog.', security: [{ bearerAuth: [] }, { localBrowserSession: [] }],
    requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['reviewed', 'capture'], properties: { reviewed: { const: true }, capture: { type: 'object', description: 'Reviewed operations, training demonstrations and held-out evaluation. See examples/learn-laptop.json.' } } } } } },
    responses: { 201: { description: 'Verified workflow available immediately' }, 400: { description: 'Invalid capture' }, 403: { description: 'Operation review required' }, 409: { description: 'Duplicate workflow or learning already in progress' }, 502: { description: 'Compilation or evaluation failed; workflow not published' } },
  } };
  if (discovery) {
    paths['/v1/discoveries'] = { post: { operationId: 'discover_product_lookup', description: 'Discover the supported list-to-detail pattern with an isolated browser, then evaluate and publish an HTTP recipe. Other task families are rejected.',
      security: [{ bearerAuth: [] }, { localBrowserSession: [] }], requestBody: { required: true, content: { 'application/json': { schema: z.toJSONSchema(discoveryRequestSchema) } } },
      responses: { 202: { description: 'Discovery job started; inspect its status before calling the workflow' }, 400: { description: 'Unsupported task or invalid target' }, 403: { description: 'Operation review required' }, 409: { description: 'Discovery already in progress' } } } };
    paths['/v1/discoveries/{job_id}'] = { get: { operationId: 'get_discovery', security: [{ bearerAuth: [] }, { localBrowserSession: [] }], parameters: [{ name: 'job_id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
      responses: { 200: { description: 'Observed progress and terminal verified/failed state' }, 404: { description: 'Unknown or evicted job' } } } };
  }
  return { openapi: '3.1.0', info: { title: 'Web2API workflow application', version: packageInfo.version }, paths, components: { securitySchemes: {
    bearerAuth: { type: 'http', scheme: 'bearer' }, localBrowserSession: { type: 'apiKey', in: 'cookie', name: 'web2api_session', description: 'Issued only by the standalone local UI; HttpOnly and SameSite=Strict.' },
  } } };
}
