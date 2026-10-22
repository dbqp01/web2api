import { chromium } from 'playwright';
import { parse, searchResult, cartResult } from '../src/contracts.mjs';

export async function discover(origin, screenshotPath) {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    page.setDefaultTimeout(10000);
    await page.goto(origin);
    const observations = [];
    async function observe(intent, input, action) {
      const pending = page.waitForResponse(r => new URL(r.url()).origin === origin && ['fetch', 'xhr'].includes(r.request().resourceType()));
      await action();
      const response = await pending;
      const request = response.request(), url = new URL(request.url());
      // Closed synthetic lab only. Never persist request headers/cookies/storage/HAR.
      const body = parse(intent === 'search_products' ? searchResult : cartResult, await response.json(), 'CAPTURE_SCHEMA_CHANGED');
      observations.push({ intent, input, method: request.method(), path: url.pathname, query: Object.fromEntries(url.searchParams), body: request.postDataJSON() ?? {}, status: response.status(), response: body, observed_at: new Date().toISOString() });
    }
    for (const input of [{ query: 'Té', max_results: 1 }, { query: 'Café', max_results: 2 }]) {
      await page.getByRole('textbox', { name: 'Buscar', exact: true }).fill(input.query);
      await page.getByRole('spinbutton', { name: 'Límite' }).fill(String(input.max_results));
      await observe('search_products', input, () => page.getByRole('button', { name: 'Buscar productos' }).click());
    }
    for (const input of [{ sku: 'tea', quantity: 1 }, { sku: 'coffee', quantity: 2 }]) {
      await observe('get_cart', {}, () => page.getByRole('button', { name: 'Consultar carrito' }).click());
      await page.getByRole('textbox', { name: 'SKU', exact: true }).fill(input.sku);
      await page.getByRole('spinbutton', { name: 'Cantidad' }).fill(String(input.quantity));
      await observe('add_to_cart', input, () => page.getByRole('button', { name: 'Agregar al carrito' }).click());
    }
    await page.screenshot({ path: screenshotPath, fullPage: true });
    return observations;
  } finally { await browser.close(); }
}
