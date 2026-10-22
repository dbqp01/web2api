import { isDeepStrictEqual } from 'node:util';
import { inputs, parse, recipeSchema, searchResult, validateCart, WorkflowError } from './contracts.mjs';
import { readJson } from './http.mjs';

export function createRunner({ recipe, origin, token, timeoutMs = 5000 }) {
  recipe = parse(recipeSchema, recipe, 'INVALID_RECIPE');
  const base = new URL(origin);
  // The first release is deliberately a loopback lab. No arbitrary URL fetch tool.
  if (base.hostname !== '127.0.0.1' || base.protocol !== 'http:' || base.username || base.password || base.pathname !== '/' || base.search || base.hash) throw new WorkflowError('ORIGIN_REJECTED', 400);
  let busy = false;
  async function request(op, { query, body } = {}) {
    const url = new URL(op.path, base);
    if (url.origin !== base.origin) throw new WorkflowError('ORIGIN_REJECTED', 400);
    for (const [key, value] of Object.entries(query ?? {})) url.searchParams.set(key, String(value));
    try {
      const response = await fetch(url, { method: op.method, redirect: 'manual', signal: AbortSignal.timeout(timeoutMs),
        headers: { Accept: 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {}) });
      if (response.status === 401 || response.status === 403) throw new WorkflowError('AUTH_EXPIRED', 401);
      if (response.status === 429) throw new WorkflowError('RATE_LIMITED', 429);
      if (response.status === 404) throw new WorkflowError('UPSTREAM_CHANGED');
      if (response.status === 409) throw new WorkflowError('UPSTREAM_CONFLICT', 409);
      if (!response.ok || !response.headers.get('content-type')?.includes('application/json')) throw new WorkflowError('UPSTREAM_UNAVAILABLE');
      return await readJson(response.body);
    } catch (error) {
      if (error instanceof WorkflowError) throw error;
      throw new WorkflowError(error.name === 'TimeoutError' ? 'UPSTREAM_TIMEOUT' : 'UPSTREAM_UNAVAILABLE');
    }
  }
  return async function run(name, raw) {
    if (!Object.hasOwn(inputs, name)) throw new WorkflowError('UNKNOWN_WORKFLOW', 404);
    const input = parse(inputs[name], raw);
    if (busy) throw new WorkflowError('WORKFLOW_BUSY', 409);
    busy = true;
    try {
      const op = recipe.operations[name]; let data;
      if (name === 'search_products') {
        data = parse(searchResult, await request(op, { query: { [op.query_key]: input.query, [op.limit_key]: input.max_results } }), 'UPSTREAM_CHANGED');
        if (data.products.length > input.max_results || data.total < data.products.length || data.truncated !== (data.total > data.products.length) || new Set(data.products.map(p => p.sku)).size !== data.products.length || data.products.some(p => !p.name.toLocaleLowerCase('es').includes(input.query.toLocaleLowerCase('es')))) throw new WorkflowError('VERIFICATION_FAILED');
      } else if (name === 'get_cart') data = validateCart(await request(op));
      else {
        const before = validateCart(await request(recipe.operations.get_cart));
        const acknowledged = validateCart(await request(op, { body: { [op.sku_key]: input.sku, [op.quantity_key]: input.quantity } }));
        const after = validateCart(await request(recipe.operations.get_cart));
        const old = before.items.find(i => i.sku === input.sku), added = after.items.find(i => i.sku === input.sku);
        if (!added || added.quantity !== (old?.quantity ?? 0) + input.quantity ||
            !isDeepStrictEqual(before.items.filter(i => i.sku !== input.sku), after.items.filter(i => i.sku !== input.sku)) ||
            (old && (old.name !== added.name || old.price_cents !== added.price_cents)) ||
            !isDeepStrictEqual(acknowledged, after)) throw new WorkflowError('EFFECT_UNVERIFIED');
        data = after;
      }
      return { data, evidence: { source_mode: recipe.source_mode, scope: recipe.scope, evidence_level: 'E4', source_url: new URL(op.path, base).href, observed_at: new Date().toISOString(), verification: name === 'add_to_cart' ? 'independent_cart_read' : 'schema_and_invariants', transport: 'http_only' } };
    } finally { busy = false; }
  };
}
