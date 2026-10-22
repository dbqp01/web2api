import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';

await mkdir('.local', { recursive: true });
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  // Public discovery cannot submit a booking, newsletter, payment or mutation.
  await page.route('**/*', route => {
    const request = route.request();
    if (!['GET', 'HEAD'].includes(request.method()) || new URL(request.url()).origin !== 'https://usgarhoteles.com') return route.abort();
    return route.continue();
  });
  const events = [], pending = [];
  page.on('response', response => {
    const url = new URL(response.url());
    if (!url.pathname.startsWith('/api/') || url.pathname.includes('/auth/')) return;
    pending.push((async () => {
      const event = { url: response.url(), method: response.request().method(), status: response.status() };
      if (response.headers()['content-type']?.includes('application/json')) event.body = await response.json();
      events.push(event);
    })());
  });
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Lima', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  const day = n => new Date(Date.parse(today) + n * 86400000).toISOString().slice(0, 10);
  await page.goto(`https://usgarhoteles.com/es/book/?checkin=${day(15)}&checkout=${day(17)}&guests=2`, { waitUntil: 'networkidle', timeout: 30000 });
  await Promise.all(pending);
  const state = await page.evaluate(() => ({ text: document.querySelector('main')?.innerText.slice(0, 6000), fields: [...document.querySelectorAll('main input,main select')].map(e => ({ id: e.id, name: e.name, value: e.value, type: e.type })), buttons: [...document.querySelectorAll('main button')].map(e => ({ text: e.textContent.trim(), id: e.id, disabled: e.disabled })) }));
  await page.screenshot({ path: '.local/usgar-book.png', fullPage: true });
  await writeFile('.local/usgar-public-discovery.json', JSON.stringify({ observed_at: new Date().toISOString(), writes_blocked: true, state, events }, null, 2));
  await mkdir('evidence', { recursive: true });
  const summary = { observed_at: new Date().toISOString(), source: 'authorized_public_browser', writes_blocked: true, external_origins_blocked: true,
    network: events.map(({ url, method, status, body }) => ({ url, method, status, json_keys: Object.keys(body ?? {}) })),
    page_assertions: { dates_visible: state.text.includes(day(15)) && state.text.includes(day(17)), public_room_selector_visible: state.text.includes('Habitaciones Disponibles') },
    discovery: 'agent_inspected_public_navigation_and_network; site_specific_adapter_handwritten', sensitive_headers_retained: false };
  await writeFile('evidence/usgar-discovery.json', JSON.stringify(summary, null, 2));
  console.log(JSON.stringify(summary, null, 2));
} finally { await browser.close(); }
