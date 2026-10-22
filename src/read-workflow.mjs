import { z } from 'zod';
import { isDeepStrictEqual } from 'node:util';
import { parse, WorkflowError } from './contracts.mjs';
import { upstreamJson } from './upstream.mjs';

const key = z.string().regex(/^[a-zA-Z_][a-zA-Z0-9_]{0,79}$/).refine(s => !['__proto__', 'prototype', 'constructor'].includes(s));
const scalar = z.union([z.string().max(1000), z.number().finite(), z.boolean(), z.null()]);
const fieldPath = z.string().max(250).refine(s => s.split('.').every(part => key.safeParse(part).success));
const binding = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('literal'), value: scalar }).strict(),
  z.object({ kind: z.literal('input'), field: key, cast: z.enum(['string', 'number']) }).strict(),
  z.object({ kind: z.literal('selection'), step: z.number().int().min(0).max(7), collection: fieldPath, match_field: fieldPath, input: key, value_field: fieldPath, cast: z.enum(['string', 'number']) }).strict(),
]);
const shapeSchema = z.lazy(() => z.discriminatedUnion('type', [
  z.object({ type: z.enum(['string', 'number', 'boolean', 'null']) }).strict(),
  z.object({ type: z.literal('object'), fields: z.record(key, shapeSchema) }).strict(),
  z.object({ type: z.literal('array'), item: shapeSchema.nullable() }).strict(),
]));
const checkSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('contains_any'), input: key, fields: z.array(fieldPath).min(1).max(30), terminal_collection: fieldPath.nullable() }).strict(),
  z.object({ kind: z.literal('join'), step: z.number().int().min(0).max(7), collection: fieldPath, terminal_collection: fieldPath.nullable(), identity: fieldPath, fields: z.array(fieldPath).min(2).max(30) }).strict(),
  z.object({ kind: z.literal('complete_search'), step: z.number().int().min(0).max(7), collection: fieldPath, terminal_collection: fieldPath, identity: fieldPath,
    filters: z.array(z.object({ input: key, fields: z.array(fieldPath).min(1).max(30) }).strict()).min(1).max(8) }).strict(),
]);
const requestSchema = z.object({ origin: z.url(), path: z.string().regex(/^\/[a-zA-Z0-9_/-]+$/), method: z.enum(['GET', 'POST']), encoding: z.enum(['query', 'json', 'form']), allow_json_text: z.boolean(), params: z.record(key, binding), shape: shapeSchema, success: z.record(fieldPath, scalar) }).strict();
export const readPolicySchema = requestSchema.pick({ origin: true, path: true, method: true, allow_json_text: true, success: true }).extend({ allow_json_text: z.boolean().default(false), success: z.record(fieldPath, scalar).default({}) });
export const readRecipeSchema = z.object({
  version: z.literal(3), id: z.string().regex(/^[a-z][a-z0-9_]{1,79}$/), effect: z.literal('read'),
  source_mode: z.enum(['observed_first_party_http', 'documented_api']), input_fields: z.array(key).min(1).max(8),
  steps: z.array(requestSchema).min(1).max(8), checks: z.array(checkSchema).min(1).max(16),
  observed_at: z.iso.datetime(), discovery: z.literal('demonstration_guided_dependency_inference'),
}).strict();

function fail(code) { throw new WorkflowError(code); }
const same = (a, b) => (typeof a === 'string' || typeof a === 'number') && String(a).trim() === String(b).trim();
const collections = object => leaves(object).filter(([, value]) => Array.isArray(value) && value.every(row => row && typeof row === 'object' && !Array.isArray(row)));
function leaves(object, prefix = '') {
  return Object.entries(object ?? {}).flatMap(([field, value]) => {
    const path = prefix ? `${prefix}.${field}` : field;
    if (value && typeof value === 'object' && !Array.isArray(value)) return leaves(value, path);
    return [[path, value]];
  });
}
const atPath = (object, path) => path.split('.').reduce((value, part) => value && Object.hasOwn(value, part) ? value[part] : undefined, object);
const includes = (value, query) => typeof value === 'string' && value.toLowerCase().includes(query.toLowerCase());
const matchingRows = (rows, filters, input) => rows.filter(row => filters.every(filter => filter.fields.some(field => includes(atPath(row, field), input[filter.input]))));
function sameIds(expected, actual, identity) {
  const ids = rows => rows.map(row => atPath(row, identity)).map(value => typeof value === 'string' || typeof value === 'number' ? String(value) : null);
  const left = ids(expected), right = ids(actual);
  return !left.includes(null) && !right.includes(null) && new Set(left).size === left.length && new Set(right).size === right.length && isDeepStrictEqual(left.sort(), right.sort());
}

function shapeOf(value, depth = 0) {
  if (depth > 6) fail('RESPONSE_TOO_COMPLEX');
  if (value === null) return { type: 'null' };
  if (Array.isArray(value)) return { type: 'array', item: value.length ? shapeOf(value[0], depth + 1) : null };
  if (typeof value === 'object') return { type: 'object', fields: Object.fromEntries(Object.entries(value).map(([field, child]) => { parse(key, field, 'UNSAFE_FIELD'); return [field, shapeOf(child, depth + 1)]; })) };
  return { type: typeof value };
}

function matches(shape, value) {
  if (!shape || typeof shape !== 'object') return false;
  if (shape.type === 'null') return value === null;
  if (shape.type === 'array') return Array.isArray(value) && value.length <= 250 && (!shape.item || value.every(item => matches(shape.item, item)));
  if (shape.type === 'object') return value && typeof value === 'object' && !Array.isArray(value) && Object.entries(shape.fields).every(([field, child]) => Object.hasOwn(value, field) && matches(child, value[field]));
  return typeof value === shape.type && (typeof value !== 'number' || Number.isFinite(value));
}

function responseBinding(traces, step, param) {
  const candidates = [];
  for (let previous = 0; previous < step; previous++) {
    for (const [collection, rows] of collections(traces[0].calls[previous].response)) {
      if (!rows.length) continue;
      for (const [value_field] of leaves(rows[0])) for (const [match_field] of leaves(rows[0])) for (const input of Object.keys(traces[0].input)) {
        if (new Set(traces.map(t => t.input[input])).size < 2) continue;
        const proven = traces.every(t => {
          const matches = atPath(t.calls[previous].response, collection)?.filter(row => same(atPath(row, match_field), t.input[input]));
          return matches?.length === 1 && same(atPath(matches[0], value_field), t.calls[step].params[param]);
        });
        if (proven) candidates.push({ kind: 'selection', step: previous, collection, match_field, input, value_field, cast: typeof traces[0].calls[step].params[param] });
      }
    }
  }
  if (candidates.length !== 1) fail(candidates.length ? 'AMBIGUOUS_DEPENDENCY' : 'UNBOUND_DYNAMIC_VALUE');
  return candidates[0];
}

function inferChecks(traces) {
  const checks = [], end = traces[0].calls.length - 1, last = traces[0].calls[end].response;
  // Verify returned records against a previous collection. A matching id alone is insufficient.
  for (let step = 0; step < end; step++) for (const [collection, rows] of collections(traces[0].calls[step].response)) {
    const terminal = Array.isArray(last) ? null : collections(last)[0]?.[0];
    const outputs = terminal ? atPath(last, terminal) : [last];
    if (!rows.length || !outputs.length) continue;
    for (const [identity, value] of leaves(outputs[0])) {
      if (!['string', 'number'].includes(typeof value)) continue;
      const fields = leaves(outputs[0]).filter(([, value]) => value === null || ['string', 'number', 'boolean'].includes(typeof value)).map(([field]) => field).filter(field => atPath(rows[0], field) !== undefined);
      if (fields.length < 2) continue;
      if (traces.every(t => {
        const results = terminal ? atPath(t.calls[end].response, terminal) : [t.calls[end].response];
        const catalog = atPath(t.calls[step].response, collection);
        if (new Set(catalog.map(row => atPath(row, identity))).size !== catalog.length) return false;
        return results.every(result => {
          const candidates = catalog.filter(row => same(atPath(row, identity), atPath(result, identity)));
          return candidates.length === 1 && fields.every(field => isDeepStrictEqual(atPath(candidates[0], field), atPath(result, field)));
        });
      })) { checks.push({ kind: 'join', step, collection, terminal_collection: terminal ?? null, identity, fields }); break; }
    }
  }
  const terminal = collections(last)[0]?.[0];
  const outputs = terminal ? atPath(last, terminal) : [last];
  for (const input of Object.keys(traces[0].input)) {
    const fields = leaves(outputs[0]).filter(([, value]) => typeof value === 'string').map(([field]) => field).filter(field => traces.some(t => {
      const results = terminal ? atPath(t.calls[end].response, terminal) : [t.calls[end].response];
      return results.some(row => includes(atPath(row, field), t.input[input]));
    }));
    if (fields.length && traces.every(t => {
      const results = terminal ? atPath(t.calls[end].response, terminal) : [t.calls[end].response];
      return results.length && results.every(row => fields.some(field => includes(atPath(row, field), t.input[input])));
    })) checks.push({ kind: 'contains_any', input, fields, terminal_collection: terminal ?? null });
  }
  if (!checks.some(c => c.kind === 'join') || !checks.some(c => c.kind === 'contains_any')) fail('UNVERIFIABLE_WORKFLOW');
  if (terminal) {
    const filters = checks.filter(c => c.kind === 'contains_any').map(({ input, fields }) => ({ input, fields }));
    const candidates = checks.filter(c => c.kind === 'join' && c.terminal_collection === terminal && traces.every(t => {
      const catalog = atPath(t.calls[c.step].response, c.collection), actual = atPath(t.calls[end].response, terminal);
      return new Set(catalog.map(row => String(atPath(row, c.identity)))).size === catalog.length && sameIds(matchingRows(catalog, filters, t.input), actual, c.identity);
    }));
    if (candidates.length !== 1) fail('UNPROVEN_SEARCH_COMPLETENESS');
    const { step, collection, identity } = candidates[0];
    checks.push({ kind: 'complete_search', step, collection, terminal_collection: terminal, identity, filters });
  }
  return checks;
}

export function compileReadWorkflow({ id, traces, approvedRequests, sourceMode = 'observed_first_party_http' }) {
  if (traces.length < 2 || traces.some(t => !t.calls.length)) fail('API_PATH_NOT_OBSERVED');
  for (const trace of traces) for (const call of trace.calls) {
    // Session HTTP and encrypted sockets need their own executor; do not drop this evidence.
    if (call.auth_context && call.auth_context !== 'none') fail('SESSION_TRANSPORT_REQUIRED');
    if (call.transport && call.transport !== 'http_json') fail('UNSUPPORTED_TRANSPORT');
  }
  const input_fields = Object.keys(traces[0].input);
  if (!input_fields.length || input_fields.some(field => new Set(traces.map(t => t.input[field])).size < 2)) fail('UNPROVEN_PARAMETER');
  if (traces.some(t => t.calls.length !== traces[0].calls.length)) fail('AMBIGUOUS_OPERATION');
  const steps = traces[0].calls.map((call, step) => {
    const approved = approvedRequests.find(r => r.origin === call.origin && r.path === call.path && r.method === call.method && !!r.allow_json_text === !!call.allow_json_text);
    if (!approved) fail('UNREVIEWED_OPERATION');
    const success = approved.success ?? {};
    if (traces.some(t => Object.entries(success).some(([field, expected]) => !isDeepStrictEqual(atPath(t.calls[step].response, field), expected)))) fail('UPSTREAM_REJECTED');
    if (traces.some(t => t.calls[step].status !== 200 || ['origin', 'path', 'method', 'encoding'].some(k => t.calls[step][k] !== call[k]))) fail('AMBIGUOUS_OPERATION');
    const params = {};
    for (const [param, value] of Object.entries(call.params)) {
      parse(key, param, 'UNSAFE_FIELD');
      if (/token|cookie|secret|password|authorization/i.test(param)) fail('SECRET_IN_RECIPE');
      const candidates = input_fields.filter(field => traces.every(t => same(t.input[field], t.calls[step].params[param])));
      if (candidates.length > 1) fail('AMBIGUOUS_PARAMETER');
      if (candidates.length === 1) params[param] = { kind: 'input', field: candidates[0], cast: typeof value };
      else if (traces.every(t => isDeepStrictEqual(t.calls[step].params[param], value))) params[param] = { kind: 'literal', value };
      else params[param] = responseBinding(traces, step, param);
    }
    if (traces.some(t => !isDeepStrictEqual(Object.keys(t.calls[step].params).sort(), Object.keys(call.params).sort()))) fail('AMBIGUOUS_PARAMETER');
    const shape = shapeOf(call.response);
    if (!traces.every(t => matches(shape, t.calls[step].response))) fail('RESPONSE_SHAPE_UNSTABLE');
    return { origin: call.origin, path: call.path, method: call.method, encoding: call.encoding, allow_json_text: !!call.allow_json_text, params, shape, success };
  });
  for (const input of input_fields) if (!steps.some(s => Object.values(s.params).some(p => p.field === input || p.input === input))) fail('UNUSED_INPUT');
  return parse(readRecipeSchema, { version: 3, id, effect: 'read', source_mode: sourceMode, input_fields, steps, checks: inferChecks(traces), observed_at: new Date().toISOString(), discovery: 'demonstration_guided_dependency_inference' }, 'INVALID_RECIPE');
}

export function readWorkflowInput(recipe) { return z.object(Object.fromEntries(recipe.input_fields.map(field => [field, z.string().trim().min(1).max(120)]))).strict(); }

function toZod(shape) {
  if (shape.type === 'object') return z.object(Object.fromEntries(Object.entries(shape.fields).map(([field, child]) => [field, toZod(child)])));
  if (shape.type === 'array') return z.array(shape.item ? toZod(shape.item) : z.unknown()).max(250);
  return { string: z.string(), number: z.number().finite(), boolean: z.boolean(), null: z.null() }[shape.type];
}
export function readWorkflowOutput(recipe) {
  return z.object({ data: toZod(recipe.steps.at(-1).shape), evidence: z.object({
    source_mode: z.enum(['observed_first_party_http', 'documented_api']), transport: z.literal('http_only'), observed_at: z.iso.datetime(), workflow: z.string(), steps_completed: z.number().int(),
    calls: z.array(z.object({ method: z.enum(['GET', 'POST']), url: z.url(), parameters: z.array(z.string()) })), verification: z.array(checkSchema),
    discovery: z.literal('demonstration_guided_dependency_inference'), autonomous_discovery: z.literal(false),
  }) });
}

export function createReadWorkflowRunner(recipe, approvedRequests) {
  recipe = parse(readRecipeSchema, recipe, 'INVALID_RECIPE');
  if (recipe.steps.some(s => !approvedRequests.some(r => r.origin === s.origin && r.path === s.path && r.method === s.method && !!r.allow_json_text === s.allow_json_text && isDeepStrictEqual(r.success ?? {}, s.success)))) fail('UNREVIEWED_OPERATION');
  for (const step of recipe.steps) {
    const origin = new URL(step.origin);
    if (origin.protocol !== 'https:' || origin.origin !== step.origin || origin.username || origin.password || step.path.includes('//') || step.path.includes('..')) fail('ORIGIN_REJECTED');
  }
  return async raw => {
    const input = parse(readWorkflowInput(recipe), raw), results = [], calls = [];
    for (let index = 0; index < recipe.steps.length; index++) {
      const step = recipe.steps[index], params = {};
      for (const [key, binding] of Object.entries(step.params)) {
        let value;
        if (binding.kind === 'literal') value = binding.value;
        else if (binding.kind === 'input') value = input[binding.field];
        else {
          if (binding.step >= index) fail('INVALID_DEPENDENCY');
          const rows = atPath(results[binding.step], binding.collection);
          const selected = rows?.filter(row => same(atPath(row, binding.match_field), input[binding.input]));
          if (!selected?.length) throw new WorkflowError('NO_MATCH', 404);
          if (selected.length !== 1) fail('AMBIGUOUS_RESULT');
          value = atPath(selected[0], binding.value_field);
        }
        params[key] = binding.kind === 'literal' ? value : binding.cast === 'number' ? Number(value) : String(value);
        if (params[key] === undefined || (typeof params[key] === 'number' && !Number.isFinite(params[key]))) fail('INVALID_DEPENDENCY');
      }
      const url = new URL(step.path, step.origin), init = { method: step.method, headers: { Accept: 'application/json' } };
      if (step.encoding === 'query') url.search = new URLSearchParams(params);
      else {
        init.headers['Content-Type'] = step.encoding === 'form' ? 'application/x-www-form-urlencoded' : 'application/json';
        init.body = step.encoding === 'form' ? new URLSearchParams(params).toString() : JSON.stringify(params);
      }
      const response = await upstreamJson(url, init, { allowJsonText: step.allow_json_text });
      if (Object.entries(step.success).some(([field, expected]) => !isDeepStrictEqual(atPath(response, field), expected))) fail('UPSTREAM_REJECTED');
      if (!matches(step.shape, response)) fail('UPSTREAM_CHANGED');
      results.push(response); calls.push({ method: step.method, url: url.href, parameters: Object.keys(params) });
    }
    const output = results.at(-1);
    for (const check of recipe.checks) {
      const rows = check.terminal_collection ? atPath(output, check.terminal_collection) : [output];
      if (!Array.isArray(rows)) fail('INVALID_POSTCONDITION');
      if (check.kind === 'contains_any') {
        if (rows.some(row => !check.fields.some(field => includes(atPath(row, field), input[check.input])))) fail('VERIFICATION_FAILED');
      } else if (check.kind === 'join') {
        if (rows.some(row => {
          const matches = atPath(results[check.step], check.collection)?.filter(prior => same(atPath(prior, check.identity), atPath(row, check.identity)));
          return matches?.length !== 1 || check.fields.some(field => !isDeepStrictEqual(atPath(matches[0], field), atPath(row, field)));
        })) fail('VERIFICATION_FAILED');
      } else if (check.kind === 'complete_search') {
        const catalog = atPath(results[check.step], check.collection);
        if (!Array.isArray(catalog) || new Set(catalog.map(row => String(atPath(row, check.identity)))).size !== catalog.length ||
            !sameIds(matchingRows(catalog, check.filters, input), rows, check.identity)) fail('SEARCH_INCOMPLETE');
      } else fail('INVALID_POSTCONDITION');
    }
    return parse(readWorkflowOutput(recipe), { data: output, evidence: { source_mode: recipe.source_mode, transport: 'http_only', observed_at: new Date().toISOString(), workflow: recipe.id, steps_completed: results.length, calls, verification: recipe.checks, discovery: recipe.discovery, autonomous_discovery: false } }, 'UPSTREAM_CHANGED');
  };
}
