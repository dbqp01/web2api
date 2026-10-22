import { parse, recipeSchema, WorkflowError } from './contracts.mjs';

// Closed three-workflow compiler. Intent/inputs are supplied by a trusted scenario,
// never guessed from arbitrary page text. Input bindings must change in two observations.
export function compile(observations) {
  function group(name) {
    const rows = observations.filter(r => r.intent === name);
    if (rows.length < 2 || rows.some(r => r.status !== 200)) throw new WorkflowError('INSUFFICIENT_EVIDENCE');
    if (rows.some(r => r.path !== rows[0].path || r.method !== rows[0].method)) throw new WorkflowError('AMBIGUOUS_OPERATION');
    return rows;
  }
  function binding(rows, field, location) {
    const candidates = Object.keys(rows[0][location]).filter(key => rows.every(r => location === 'query' ? String(r[location][key]) === String(r.input[field]) : r[location][key] === r.input[field]));
    if (candidates.length !== 1 || new Set(rows.map(r => r.input[field])).size < 2) throw new WorkflowError('UNPROVEN_PARAMETER');
    return candidates[0];
  }
  const searches = group('search_products'), carts = group('get_cart'), adds = group('add_to_cart');
  const op = r => ({ method: r.method, path: r.path });
  return parse(recipeSchema, {
    version: 1, scope: 'controlled_lab_only', source_mode: 'observed_first_party_http', observed_at: new Date().toISOString(),
    operations: {
      search_products: { ...op(searches[0]), query_key: binding(searches, 'query', 'query'), limit_key: binding(searches, 'max_results', 'query') },
      get_cart: op(carts[0]),
      add_to_cart: { ...op(adds[0]), sku_key: binding(adds, 'sku', 'body'), quantity_key: binding(adds, 'quantity', 'body') },
    },
  }, 'INVALID_RECIPE');
}
