import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';

await mkdir('artifacts/multisite', { recursive: true });
await mkdir('.local/multisite', { recursive: true });
const browser = await chromium.launch({ headless: true });
const results = {};
function normalized(response, body, source = 'browser_network', params = undefined) {
  const request = response.request(), url = new URL(response.url());
  const method = request.method(), type = request.headers()['content-type'] || '';
  const encoding = method === 'GET' ? 'query' : type.includes('application/x-www-form-urlencoded') ? 'form' : 'json';
  const data = params ?? (method === 'GET' ? Object.fromEntries(url.searchParams) : request.postDataJSON());
  if (Object.keys(data).some(k => /token|cookie|secret|password|authorization/i.test(k))) throw Error('Sensitive capture rejected');
  return { origin: url.origin, path: url.pathname, method, encoding, allow_json_text: !response.headers()['content-type']?.includes('application/json'), params: data, status: response.status(), response: body, source };
}
async function screenshot(page, name, locator = null) {
  const path = `artifacts/multisite/${name}.png`;
  if (locator) await locator.screenshot({ path }); else await page.screenshot({ path, fullPage: false });
  return path;
}

try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  try {
    const traces = [];
    for (const [i, product_name] of ['Samsung galaxy s6', 'Nokia lumia 1520', 'Nexus 6'].entries()) {
      await page.goto('https://www.demoblaze.com/', { waitUntil: 'domcontentloaded', timeout: 25000 });
      await page.getByRole('link', { name: 'Phones', exact: true }).waitFor();
      const categoryResponse = page.waitForResponse(r => new URL(r.url()).origin === 'https://api.demoblaze.com' && r.request().method() === 'POST');
      await page.getByRole('link', { name: 'Phones', exact: true }).click();
      const first = await categoryResponse, firstBody = await first.json();
      await page.getByRole('link', { name: product_name, exact: true }).waitFor();
      const categoryScreen = await screenshot(page, `demoblaze-${i + 1}-category`);
      const detailResponse = page.waitForResponse(r => new URL(r.url()).origin === 'https://api.demoblaze.com' && r.request().method() === 'POST');
      await page.getByRole('link', { name: product_name, exact: true }).click();
      const second = await detailResponse, secondBody = await second.json();
      await page.getByRole('heading', { name: product_name, exact: true }).waitFor();
      const headings = await page.getByRole('heading').allTextContents();
      const detailScreen = await screenshot(page, `demoblaze-${i + 1}-detail`);
      const priceHeading = headings.find(text => text.includes('$'));
      assert(priceHeading, 'Missing visible price');
      const visiblePrice = Number(/\$\s*([\d.]+)/.exec(priceHeading)?.[1]);
      assert.equal(visiblePrice, secondBody.price);
      assert.equal(secondBody.title, product_name);
      traces.push({ input: { product_name }, calls: [normalized(first, firstBody), normalized(second, secondBody)], visual: { page_url: page.url(), name: product_name, price: visiblePrice, currency_label: '$', screenshots: [categoryScreen, detailScreen] } });
    }
    results.demoblaze = { status: 'captured', traces };
  } catch (error) { results.demoblaze = { status: 'failed', error: error.message }; }
  finally { await page.close(); }

  const ae = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  await ae.route('**/*', route => new URL(route.request().url()).origin === 'https://automationexercise.com' ? route.continue() : route.abort());
  try {
    const traces = [];
    for (const [i, query] of ['top', 'dress', 'blue', 'tshirt'].entries()) {
      await ae.goto('https://automationexercise.com/products', { waitUntil: 'domcontentloaded', timeout: 25000 });
      await ae.getByPlaceholder('Search Product', { exact: true }).fill(query);
      await ae.locator('#submit_search').click();
      await ae.getByRole('heading', { name: 'Searched Products', exact: true }).waitFor();
      const cards = ae.locator('.features_items .product-image-wrapper');
      const names = await cards.locator('.productinfo p').allTextContents();
      const firstCard = cards.first();
      const name = (await firstCard.locator('.productinfo p').innerText()).trim();
      const price = (await firstCard.locator('.productinfo h2').innerText()).trim();
      const detailLink = firstCard.locator('a[href^="/product_details/"]');
      const link = await detailLink.getAttribute('href');
      const searchScreen = await screenshot(ae, `automationexercise-${i + 1}-search`, ae.locator('.features_items'));
      await detailLink.click();
      await ae.getByRole('heading', { name, exact: true }).waitFor();
      const detailText = await ae.locator('.product-information').innerText();
      assert(detailText.includes(price));
      const detailScreen = await screenshot(ae, `automationexercise-${i + 1}-detail`, ae.locator('.product-details'));
      // Official read APIs are documented at /api_list; these are not browser-observed UI endpoints.
      const catalog = await ae.request.get('https://automationexercise.com/api/productsList');
      const search = await ae.request.post('https://automationexercise.com/api/searchProduct', { form: { search_product: query } });
      const catalogBody = await catalog.json(), searchBody = await search.json();
      const id = Number(link.split('/').at(-1));
      const product = searchBody.products.find(p => p.id === id);
      assert.equal(product.name, name); assert.equal(product.price, price);
      assert.deepEqual(searchBody.products.map(p => p.name).sort(), names.map(n => n.trim()).sort());
      const call = (response, body, method, path, params) => ({ origin: 'https://automationexercise.com', path, method, encoding: method === 'GET' ? 'query' : 'form', allow_json_text: response.headers()['content-type'].includes('text/html'), params, status: response.status(), response: body, source: 'documented_api' });
      traces.push({ input: { query }, calls: [call(catalog, catalogBody, 'GET', '/api/productsList', {}), call(search, searchBody, 'POST', '/api/searchProduct', { search_product: query })], visual: { page_url: ae.url(), id, name, price_label: price, search_result_names: names.map(n => n.trim()), screenshots: [searchScreen, detailScreen] } });
    }
    results.automationexercise = { status: 'captured', traces };
  } catch (error) { results.automationexercise = { status: 'failed', error: error.message }; }
  finally { await ae.close(); }

  const sauce = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const dataRequests = [];
  sauce.on('response', r => { if (new URL(r.url()).origin === 'https://www.saucedemo.com' && ['fetch', 'xhr'].includes(r.request().resourceType())) dataRequests.push({ path: new URL(r.url()).pathname, method: r.request().method(), status: r.status() }); });
  try {
    await sauce.goto('https://www.saucedemo.com/', { waitUntil: 'networkidle' });
    // Published demo credentials, used only in this disposable context; never captured.
    await sauce.getByPlaceholder('Username', { exact: true }).fill('standard_user');
    await sauce.getByPlaceholder('Password', { exact: true }).fill('secret_sauce');
    await sauce.getByRole('button', { name: 'Login', exact: true }).click();
    await sauce.locator('[data-test="inventory-item-name"]').first().waitFor();
    const name = await sauce.locator('[data-test="inventory-item-name"]').first().innerText();
    const catalogScreen = await screenshot(sauce, 'saucedemo-catalog');
    await sauce.getByText(name, { exact: true }).click();
    await sauce.getByRole('button', { name: 'Back to products', exact: true }).waitFor();
    const detailScreen = await screenshot(sauce, 'saucedemo-detail');
    results.saucedemo = { status: dataRequests.length ? 'investigate' : 'unsupported_observed_path', steps: ['demo_login', 'browse_catalog', 'open_product_detail'], product_name: name, data_requests: dataRequests, screenshots: [catalogScreen, detailScreen], reason: 'No first-party fetch/XHR data request observed for the tested flow. This does not prove no API exists.' };
  } catch (error) { results.saucedemo = { status: 'failed', error: error.message }; }
  finally { await sauce.close(); }
} finally { await browser.close(); }
await writeFile('.local/multisite/captures.json', JSON.stringify({ observed_at: new Date().toISOString(), browser_closed: true, results }, null, 2));
for (const [site, result] of Object.entries(results)) console.log(JSON.stringify({ site, status: result.status, error: result.error, calls: result.traces?.[0]?.calls.map(c => ({ origin: c.origin, path: c.path, method: c.method, params: c.params, allow_json_text: c.allow_json_text })), cases: result.traces?.map(t => ({ input: t.input, visual: t.visual })), data_requests: result.data_requests }));
if (Object.values(results).some(r => r.status === 'failed')) process.exitCode = 1;
