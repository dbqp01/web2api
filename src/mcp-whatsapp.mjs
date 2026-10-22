import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createWhatsAppRunner, whatsappDefinitions } from './whatsapp.mjs';
import { createWorkflowServer } from './mcp-core.mjs';
import manifest from '../plugin.json' with { type: 'json' };

const runner = createWhatsAppRunner();
await runner.start();

const server = createWorkflowServer({
  name: 'web2api-whatsapp',
  version: manifest.version,
  definitions: whatsappDefinitions,
  run: runner.run,
  scope: 'whatsapp_personal_read_only',
});

for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, async () => {
  await runner.close();
  process.exit(0);
});

await server.connect(new StdioServerTransport());
