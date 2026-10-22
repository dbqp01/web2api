import { chromium } from 'playwright';
import { lookup } from 'node:dns/promises';
import { discoverProductLookup } from '../src/discovery.mjs';
import { WorkflowError } from '../src/contracts.mjs';
import { isPublicAddress } from '../src/network-boundary.mjs';
let browser;
const close = async () => { if (browser) await browser.close().catch(() => {}); };
process.once('disconnect', close); process.once('SIGTERM', close);
process.once('message', async request => {
  const send = value => process.connected && process.send(value);
  const blocked = [];
  try {
    const target = new URL(request.url), approved = request.readPolicies;
    if (target.protocol !== 'https:' || target.username || target.password || target.hash) throw new WorkflowError('ORIGIN_REJECTED', 400);
    const addresses = new Map();
    async function allowed(url) {
      if (url.protocol !== 'https:' || url.username || url.password) return false;
      const values = await lookup(url.hostname, { all: true }).catch(() => []);
      if (!values.length || !values.every(value => isPublicAddress(value.address))) return false;
      // Stop if DNS changes during this job; this is a boundary check, not network isolation.
      const resolved = values.map(value => value.address).sort().join(',');
      if (addresses.has(url.hostname) && addresses.get(url.hostname) !== resolved) return false;
      addresses.set(url.hostname, resolved); return true;
    }
    if (!await allowed(target)) throw new WorkflowError('ORIGIN_REJECTED', 400);
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ serviceWorkers: 'block', acceptDownloads: false });
    await context.routeWebSocket('**/*', socket => socket.close({ code: 1008, reason: 'Discovery supports reviewed HTTP reads only.' }));
    let rateLimited = false;
    context.on('response', response => { if (response.status() === 429) rateLimited = true; });
    await context.route('**/*', async route => {
      const request = route.request(), url = new URL(request.url()), method = request.method();
      if (rateLimited || !await allowed(url)) { await route.abort(); return; }
      if (!['GET', 'HEAD', 'OPTIONS'].includes(method) && !approved.some(operation => operation.origin === url.origin && operation.path === url.pathname && operation.method === method)) {
        blocked.push({ origin: url.origin, path: url.pathname, method }); await route.abort(); return;
      }
      await route.continue();
    });
    const result = await discoverProductLookup(context, request, event => send({ type: 'progress', ...event }));
    await close(); send({ type: 'result', ...result });
  } catch (error) {
    await close();
    const reviewNeeded = blocked.length && ['CATALOG_NOT_DISCOVERED', 'DETAIL_API_NOT_DISCOVERED'].includes(error.code);
    send({ type: 'error', code: reviewNeeded ? 'OPERATION_REVIEW_REQUIRED' : error instanceof WorkflowError ? error.code : /Executable doesn't exist/.test(error.message) ? 'BROWSER_SETUP_REQUIRED' : error.name === 'TimeoutError' ? 'DISCOVERY_TIMEOUT' : 'DISCOVERY_FAILED',
      ...(reviewNeeded ? { blocked_operations: [...new Map(blocked.map(operation => [`${operation.method} ${operation.origin}${operation.path}`, operation])).values()].slice(0, 8) } : {}) });
  } finally { if (process.connected) process.disconnect(); }
});
