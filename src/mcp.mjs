import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { loadCatalog } from './catalog.mjs';
import { createWorkflowServer } from './mcp-core.mjs';
import manifest from '../plugin.json' with { type: 'json' };

try {
  const { run, definitions, scope } = await loadCatalog();
  const server = createWorkflowServer({ name: 'web2api', version: manifest.version, definitions, run, scope });
  await server.connect(new StdioServerTransport());
} catch { console.error('Web2API cannot start: check release evidence/environment; revalidate with npm run test:live (USGAR) or npm run demo (lab).'); process.exitCode = 1; }
