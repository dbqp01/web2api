import { createApi } from '../src/api.mjs';
import { loadCatalog } from '../src/catalog.mjs';
import { listen } from '../src/http.mjs';
try {
  const running = await listen(createApi({ ...await loadCatalog(), apiKey: process.env.WEB2API_API_KEY }), 4319);
  console.error(`Web2API REST: ${running.origin}/v1/catalog`);
} catch { console.error('Web2API REST cannot start: verified catalog and WEB2API_API_KEY (32+ characters) required.'); process.exitCode = 1; }
