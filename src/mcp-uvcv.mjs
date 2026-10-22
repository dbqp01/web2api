import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { loadUvcvCatalog } from './catalog.mjs';
import { createWorkflowServer } from './mcp-core.mjs';
import manifest from '../plugin.json' with { type: 'json' };

try {
  const { definitions, run, scope } = await loadUvcvCatalog();
  const server = createWorkflowServer({ name: 'web2api-uvcv', version: manifest.version, definitions, run, scope });
  await server.connect(new StdioServerTransport());
} catch (error) {
  console.error(`Web2API UVCV cannot start: ${error.code ?? error.message}. Run npm run uvcv:login and npm run uvcv:validate.`);
  process.exitCode = 1;
}
