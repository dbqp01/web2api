import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { z } from 'zod';
import { parse, WorkflowError } from './contracts.mjs';
import { errorResponse, json, listen, readJson, validHost } from './http.mjs';

// Synthetic products; the browser/discovery module does not import this catalog.
const products = [
  { sku: 'tea', name: 'Té verde', price_cents: 1200 },
  { sku: 'coffee', name: 'Café peruano', price_cents: 2500 },
  { sku: 'cup', name: 'Taza de cerámica', price_cents: 1800 },
];
const html = `<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Web2API · Laboratorio</title>
<style>body{font:18px system-ui;max-width:800px;margin:4rem auto;padding:1rem;background:#f6f4ee;color:#262621}button,input{font:inherit;padding:.6rem}li{margin:1rem 0}button{cursor:pointer}:focus-visible{outline:3px solid #85621b}</style>
<h1>Laboratorio Web2API</h1><p>Productos ficticios · PEN · sin pagos</p>
<form id="search"><label>Buscar <input name="query" maxlength="120"></label><label>Límite <input name="max_results" type="number" min="1" max="50" value="20"></label><button>Buscar productos</button></form>
<ul id="products" aria-live="polite"></ul>
<form id="add"><label>SKU <input name="sku" required></label><label>Cantidad <input name="quantity" type="number" min="1" max="99" value="1" required></label><button>Agregar al carrito</button></form>
<button id="cart">Consultar carrito</button><pre id="result" role="status"></pre>
<script type="module">
const output=document.querySelector('#result');
async function request(path,init){const response=await fetch(path,init);const body=await response.json();if(!response.ok)throw Error(body.error.code);return body;}
document.querySelector('#search').onsubmit=async event=>{event.preventDefault();try{const f=new FormData(event.target);const data=await request('/x/p7?term='+encodeURIComponent(f.get('query'))+'&take='+f.get('max_results'));const list=document.querySelector('#products');list.replaceChildren();for(const p of data.products){const li=document.createElement('li');li.textContent=p.sku+' · '+p.name+' · S/ '+(p.price_cents/100).toFixed(2);list.append(li);}}catch(error){output.textContent=error.message;}};
document.querySelector('#add').onsubmit=async event=>{event.preventDefault();try{const f=new FormData(event.target);output.textContent=JSON.stringify(await request('/x/m4',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({item:f.get('sku'),units:Number(f.get('quantity'))})}),null,2);}catch(error){output.textContent=error.message;}};
document.querySelector('#cart').onclick=async()=>{try{output.textContent=JSON.stringify(await request('/x/c9'),null,2);}catch(error){output.textContent=error.message;}};
</script></html>`;

export async function createLab({ stateFile, token = randomBytes(32).toString('hex') }) {
  await mkdir(dirname(stateFile), { recursive: true });
  await writeFile(stateFile, JSON.stringify({ items: [] }));
  let fault = null;
  function cart(items) { return { items, subtotal_cents: items.reduce((s, i) => s + i.quantity * i.price_cents, 0), currency: 'PEN' }; }
  const server = createServer(async (req, res) => {
    try {
      validHost(req);
      const url = new URL(req.url, `http://${req.headers.host}`);
      if (req.method === 'GET' && url.pathname === '/') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Set-Cookie': `lab_session=${token}; HttpOnly; SameSite=Strict; Path=/`, 'Cache-Control': 'no-store' });
        res.end(html); return;
      }
      if (fault === 'rate_limit') { res.setHeader('Retry-After', '1'); json(res, 429, { error: { code: 'RATE_LIMITED' } }); return; }
      if (url.pathname === '/x/p7' && req.method === 'GET') {
        const query = parse(z.string().max(120), url.searchParams.get('term') ?? '');
        const take = parse(z.coerce.number().int().min(1).max(50), url.searchParams.get('take') ?? 20);
        const matches = products.filter(p => p.name.toLocaleLowerCase('es').includes(query.toLocaleLowerCase('es')));
        json(res, 200, fault === 'schema' ? { result: matches } : { products: matches.slice(0, take), total: matches.length, truncated: matches.length > take, currency: 'PEN' }); return;
      }
      if (req.headers.authorization !== `Bearer ${token}` && !(req.headers.cookie || '').split('; ').includes(`lab_session=${token}`)) throw new WorkflowError('AUTH_EXPIRED', 401);
      const state = JSON.parse(await readFile(stateFile, 'utf8'));
      if (url.pathname === '/x/c9' && req.method === 'GET') { json(res, 200, cart(state.items)); return; }
      if (url.pathname === '/x/m4' && req.method === 'POST') {
        if (fault === 'route') throw new WorkflowError('NOT_FOUND', 404);
        const body = parse(z.object({ item: z.string(), units: z.number().int().min(1).max(99) }).strict(), await readJson(req));
        const p = products.find(p => p.sku === body.item);
        if (!p) throw new WorkflowError('NOT_FOUND', 404);
        const old = state.items.find(i => i.sku === p.sku);
        if ((old?.quantity ?? 0) + body.units > 99) throw new WorkflowError('QUANTITY_LIMIT', 409);
        if (old) old.quantity += body.units; else state.items.push({ ...p, quantity: body.units });
        if (fault !== 'false_success') {
          await writeFile(`${stateFile}.tmp`, JSON.stringify(state));
          await rename(`${stateFile}.tmp`, stateFile);
        }
        json(res, 200, cart(state.items)); return;
      }
      throw new WorkflowError('NOT_FOUND', 404);
    } catch (error) { errorResponse(res, error); }
  });
  // One laboratory actor only. Tests change faults out of band, never via exposed endpoints.
  return { server, token, setFault(value) { fault = value; }, async oracle() { return JSON.parse(await readFile(stateFile, 'utf8')); } };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const lab = await createLab({ stateFile: resolve('.local/cart.json'), token: process.env.WEB2API_UPSTREAM_TOKEN || undefined });
  const running = await listen(lab.server, 4318);
  console.error(`Synthetic lab: ${running.origin}`);
}
