import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';

await mkdir('artifacts/multisite', { recursive: true });
const browser = await chromium.launch({ headless: true });
try {
  for (const [id, url] of [['demoblaze', 'https://www.demoblaze.com/'], ['automationexercise', 'https://automationexercise.com/products'], ['saucedemo', 'https://www.saucedemo.com/']]) {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    const events = [];
    page.on('response', r => { if (['fetch', 'xhr'].includes(r.request().resourceType())) events.push({ url: new URL(r.url()).origin + new URL(r.url()).pathname, method: r.request().method(), status: r.status() }); });
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 25000 });
      await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
      await page.screenshot({ path: `artifacts/multisite/${id}-start.png`, fullPage: false });
      const state = await page.evaluate(() => ({ title: document.title, text: document.body.innerText.slice(0, 2500), links: [...document.querySelectorAll('a')].map(a => ({ text: a.textContent.trim().slice(0, 70), href: a.getAttribute('href') })).filter(a => a.text).slice(0, 35), fields: [...document.querySelectorAll('input')].map(i => ({ id: i.id, placeholder: i.placeholder, type: i.type })) }));
      await writeFile(`artifacts/multisite/${id}-surface.json`, JSON.stringify({ state, events }, null, 2));
      console.log(JSON.stringify({ id, state, events }));
    } catch (e) { console.log(JSON.stringify({ id, error: e.message })); }
    finally { await page.close(); }
  }
} finally { await browser.close(); }
