import { isDeepStrictEqual } from 'node:util';
import { WorkflowError } from './contracts.mjs';

const normalize = value => String(value).trim().replace(/\s+/g, ' ').toLowerCase();
function leaves(object, prefix = '') {
  if (!object || typeof object !== 'object') return [];
  return Object.entries(object).flatMap(([key, value]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    return value && typeof value === 'object' && !Array.isArray(value) ? leaves(value, path) : [[path, value]];
  });
}
const atPath = (object, path) => path.split('.').reduce((value, part) => value && Object.hasOwn(value, part) ? value[part] : undefined, object);
export function chooseCatalog(calls, links) {
  const candidates = [];
  for (const call of calls) for (const [collection, rows] of leaves(call.response)) {
    if (!Array.isArray(rows) || rows.length < 3 || rows.length > 250 || rows.some(row => !row || typeof row !== 'object' || Array.isArray(row))) continue;
    const pairs = rows.flatMap(row => {
      const matches = links.filter(link => leaves(row).some(([, value]) => typeof value === 'string' && normalize(value) === normalize(link.text)));
      return matches.length === 1 ? [{ row, link: matches[0] }] : [];
    });
    if (pairs.length >= 3 && new Set(pairs.map(pair => normalize(pair.link.text))).size === pairs.length) candidates.push({ call, collection, pairs });
  }
  candidates.sort((a, b) => b.pairs.length - a.pairs.length);
  if (!candidates.length) throw new WorkflowError('CATALOG_NOT_DISCOVERED');
  if (candidates[1]?.pairs.length === candidates[0].pairs.length && !isDeepStrictEqual(candidates[0].call.response, candidates[1].call.response)) throw new WorkflowError('AMBIGUOUS_CATALOG');
  return candidates[0];
}

export function chooseDetail(calls, record, visibleText, name) {
  const text = normalize(visibleText);
  if (!text.includes(normalize(name))) throw new WorkflowError('DETAIL_UI_UNVERIFIED');
  const candidates = calls.flatMap(call => {
    if (!call.response || typeof call.response !== 'object' || Array.isArray(call.response)) return [];
    const fields = leaves(record).filter(([field, value]) => ['string', 'number'].includes(typeof value) && isDeepStrictEqual(atPath(call.response, field), value));
    if (fields.length < 2 || !fields.some(([, value]) => normalize(value) === normalize(name))) return [];
    const visible = fields.filter(([, value]) => normalize(value).length >= 3 && text.includes(normalize(value)));
    if (visible.length < 2) return [];
    return [{ call, matched_fields: visible.map(([field]) => field) }];
  });
  if (candidates.length !== 1) throw new WorkflowError(candidates.length ? 'AMBIGUOUS_DETAIL' : 'DETAIL_API_NOT_DISCOVERED');
  return candidates[0];
}

// This planner implements list → exact-name selection → detail, not arbitrary intent interpretation.
export async function discoverProductLookup(context, { url, goal, category, id, readPolicies }, progress = () => {}) {
  const page = await context.newPage();
  page.setDefaultTimeout(12000);
  const calls = [], pending = new Set();
  let networkFailure;
  page.on('response', response => {
    const request = response.request(), target = new URL(response.url());
    if (!['xhr', 'fetch'].includes(request.resourceType()) || !['GET', 'POST'].includes(request.method())) return;
    const policy = readPolicies.find(policy => policy.origin === target.origin && policy.path === target.pathname && policy.method === request.method());
    if (request.method() === 'POST' && !policy) return;
    if (response.status() === 429) { networkFailure = new WorkflowError('RATE_LIMITED', 429); return; }
    if ([401, 403].includes(response.status())) { networkFailure = new WorkflowError('AUTH_EXPIRED', 401); return; }
    const type = response.headers()['content-type'] || '';
    if (response.status() !== 200 || !(type.includes('application/json') || (policy?.allow_json_text && type.includes('text/html')))) return;
    const promise = (async () => {
      if (Number(response.headers()['content-length'] || 0) > 262144) return;
      const body = await response.body(); if (body.length > 262144) return;
      const params = request.method() === 'GET' ? Object.fromEntries(target.searchParams) : request.postDataJSON();
      if (!params || Object.keys(params).some(key => /token|cookie|secret|password|authorization/i.test(key))) return;
      const data = JSON.parse(body.toString('utf8'));
      calls.push({ origin: target.origin, path: target.pathname, method: request.method(), encoding: request.method() === 'GET' ? 'query' : request.headers()['content-type']?.includes('application/x-www-form-urlencoded') ? 'form' : 'json',
        allow_json_text: !type.includes('application/json'), params, status: response.status(), response: data });
    })().catch(() => {}).finally(() => pending.delete(promise));
    pending.add(promise);
  });
  async function settle() {
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    await Promise.all([...pending]);
    if (networkFailure) throw networkFailure;
  }
  progress({ stage: 'opening', detail: 'Opening the authorized site in an isolated browser.' });
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 25000 }); await settle();
  if (category) {
    const link = page.getByRole('link', { name: category, exact: true });
    if (await link.count() !== 1) throw new WorkflowError('CATEGORY_NOT_FOUND');
    calls.length = 0;
    await link.click(); await settle();
  }
  // DOM only supplies observed links and visible text. No endpoint or identifier is guessed.
  const links = await page.locator('a[href]').evaluateAll(elements => elements.filter(element => element.getClientRects().length && element.innerText.trim()).map(element => ({ text: element.innerText.trim(), href: element.href })));
  const origin = new URL(url).origin;
  const safeLinks = links.filter(link => {
    const target = new URL(link.href);
    return target.origin === origin && target.href !== page.url() && !target.hash && !/\b(add|delete|remove|logout|checkout|buy|pay)\b/i.test(`${target.pathname} ${link.text}`);
  });
  const catalog = chooseCatalog(calls, safeLinks), traces = [];
  progress({ stage: 'catalog_observed', detail: `${catalog.pairs.length} visible records matched a captured JSON collection.` });
  for (const [index, { row, link }] of catalog.pairs.slice(0, 3).entries()) {
    const start = calls.length;
    await page.goto(link.href, { waitUntil: 'domcontentloaded', timeout: 25000 }); await settle();
    const visibleText = await page.locator('body').innerText();
    const detail = chooseDetail(calls.slice(start), row, visibleText, link.text);
    traces.push({ input: { product_name: link.text }, calls: [catalog.call, detail.call], visual: { name: link.text, page_url: page.url(), matched_fields: detail.matched_fields } });
    progress({ stage: index < 2 ? 'demonstration_observed' : 'held_out_observed', detail: `Record ${index + 1}: UI and API fields agree.`, completed: index + 1 });
  }
  const approved_requests = [...new Map(traces.flatMap(trace => trace.calls.map(call => {
    const policy = readPolicies.find(policy => policy.origin === call.origin && policy.path === call.path && policy.method === call.method);
    const operation = { origin: call.origin, path: call.path, method: call.method, allow_json_text: call.allow_json_text, success: policy?.success || {} };
    return [`${call.method} ${call.origin}${call.path}`, operation];
  }))).values()];
  const capture = { id, description: `${goal} (discovered list and detail workflow; public read-only HTTP).`, effect: 'read', source_mode: 'observed_first_party_http', approved_requests,
    training: traces.slice(0, 2), evaluation: traces.slice(2) };
  if (Buffer.byteLength(JSON.stringify(capture)) > 950000) throw new WorkflowError('CAPTURE_TOO_LARGE');
  await page.close();
  return { capture, discovery: { planner: 'bounded_product_lookup', autonomous_actions: true, catalog_observed_once: true, demonstrations: 2, held_out_cases: 1,
    site_specific_selectors_supplied: false, record_ids_supplied: false, reviewed_network_policy_supplied: true, category: category || null } };
}
