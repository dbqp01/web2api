import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { z } from 'zod';
import { createLab } from '../src/lab.mjs';
import { createApp } from '../src/app.mjs';
import { compile } from '../src/compiler.mjs';
import { createRunner } from '../src/runner.mjs';
import { inputs, parse } from '../src/contracts.mjs';
import { listen } from '../src/http.mjs';

export async function startStudioDemo({ port = 4320 } = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'web2api-studio-'));
  let upstream, app;
  async function close() {
    try { if (app) await app.close(); } finally {
      try { if (upstream) await upstream.close(); } finally { await rm(directory, { recursive: true, force: true }); }
    }
  }
  try {
    const stateFile = join(directory, 'cart.json'), lab = await createLab({ stateFile });
    upstream = await listen(lab.server);
    const observations = [];
    async function observe(intent, path, input, query = {}, body = {}) {
      const url = new URL(path, upstream.origin), method = intent === 'add_to_cart' ? 'POST' : 'GET';
      for (const [name, value] of Object.entries(query)) url.searchParams.set(name, value);
      const response = await fetch(url, { method, headers: { Authorization: `Bearer ${lab.token}`, ...(method === 'POST' ? { 'Content-Type': 'application/json' } : {}) }, ...(method === 'POST' ? { body: JSON.stringify(body) } : {}) });
      await response.json();
      if (!response.ok) throw new Error('Local demonstration setup failed');
      observations.push({ intent, path, input, query, body, method, status: response.status });
    }
    // These are fresh observations of our own synthetic API, not public-site discovery.
    for (const [query, limit, sku, quantity] of [['Té', 5, 'tea', 1], ['Café', 10, 'coffee', 2]]) {
      await observe('search_products', '/x/p7', { query, max_results: limit }, { term: query, take: limit });
      await observe('add_to_cart', '/x/m4', { sku, quantity }, {}, { item: sku, units: quantity });
      await observe('get_cart', '/x/c9', {});
    }
    const recipe = compile(observations), run = createRunner({ recipe, origin: upstream.origin, token: lab.token });
    await writeFile(stateFile, JSON.stringify({ items: [] }));
    const descriptions = {
      search_products: 'Busca entre Té verde, Café peruano y Taza de cerámica. Productos ficticios; precios en PEN. Una búsqueda vacía devuelve el catálogo completo.',
      get_cart: 'Lee el carrito ficticio y verifica sus cantidades y subtotal. El estado se conserva durante esta sesión de demostración.',
      add_to_cart: 'Añade un producto ficticio y comprueba el cambio con una lectura HTTP independiente. Requiere confirmación; no hay pagos ni reintentos automáticos.',
    };
    const catalog = { definitions: Object.fromEntries(Object.entries(inputs).map(([id, input]) => [id, { input, description: descriptions[id], effect: id === 'add_to_cart' ? 'write' : 'read' }])), run, scope: 'controlled_lab_only' };
    app = await listen(await createApp({ catalog, stateDirectory: join(directory, 'workflows') }), port);
    return { origin: app.origin, close };
  } catch (error) { await close(); throw error; }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const port = parse(z.coerce.number().int().min(0).max(65535), process.env.WEB2API_PORT ?? 4320, 'INVALID_PORT');
    const demo = await startStudioDemo({ port });
    console.log(`Web2API Studio demo: ${demo.origin}\nProductos ficticios, HTTP real. Sin Internet. Ctrl+C para cerrar y borrar el estado temporal.`);
    let stopping = false;
    const stop = async () => { if (stopping) return; stopping = true; await demo.close(); };
    process.once('SIGINT', stop); process.once('SIGTERM', stop);
  } catch { console.error('No se pudo iniciar la demo. Comprueba el puerto y los archivos de la app.'); process.exitCode = 1; }
}
