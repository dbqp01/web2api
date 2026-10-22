import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { discoverProductLookup } from '../src/discovery.mjs';
import { learnReadWorkflow } from '../src/learning.mjs';

test('browser planner discovers two opaque site layouts; reserved HTTP replay uses no browser', async t => {
  let handler;
  t.mock.method(globalThis, 'fetch', (...args) => handler(...args));
  for (const variant of [1, 2]) {
    const key = `ref_${variant}`, label = `label_${variant}`, cost = `amount_${variant}`;
    const rows = ['Copper kettle', 'Glass jug', 'Steel cup', 'Wooden tray'].map((name, index) => ({ [key]: index + 71, [label]: name, [cost]: (index + 3) * 100 }));
    const origin = `https://site-${variant}.example`, catalog = { envelope: { inventory: rows } };
    const browser = await chromium.launch();
    let result;
    try {
      const context = await browser.newContext({ serviceWorkers: 'block' });
      await context.route('**/*', async route => {
        const url = new URL(route.request().url());
        if (url.pathname === `/data_a_${variant}`) return route.fulfill({ json: catalog });
        if (url.pathname === `/data_b_${variant}`) return route.fulfill({ json: rows.find(row => String(row[key]) === url.searchParams.get('opaque')) });
        const html = url.pathname === '/' ? `<h1>Catalog</h1><main></main><script>fetch('/data_a_${variant}').then(r=>r.json()).then(data=>{for(const row of data.envelope.inventory){const a=document.createElement('a');a.href='/card?reference='+row.${key};a.textContent=row.${label};document.querySelector('main').append(a)}})</script>` :
          `<h1>Detail</h1><main></main><script>fetch('/data_b_${variant}?opaque='+new URLSearchParams(location.search).get('reference')).then(r=>r.json()).then(row=>{const h=document.createElement('h2');h.textContent=row.${label};const p=document.createElement('p');p.textContent='Price: '+row.${cost};document.querySelector('main').append(h,p)})</script>`;
        await route.fulfill({ contentType: 'text/html', body: html });
      });
      result = await discoverProductLookup(context, { url: `${origin}/`, goal: 'Find a product by exact name', id: `lookup_variant_${variant}`, readPolicies: [] });
      assert.equal(result.capture.training.length, 2); assert.equal(result.capture.evaluation[0].input.product_name, 'Steel cup');
    } finally { await browser.close(); }
    handler = async url => {
      const request = new URL(url);
      return Response.json(request.pathname === `/data_a_${variant}` ? catalog : rows.find(row => String(row[key]) === request.searchParams.get('opaque')));
    };
    const bundle = await learnReadWorkflow(result.capture);
    assert.equal(bundle.recipe.steps[1].params.opaque.kind, 'selection');
    assert.equal(bundle.verification.held_out_inputs[0].product_name, 'Steel cup');
  }
});
