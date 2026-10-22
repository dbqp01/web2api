import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { WorkflowError } from './contracts.mjs';

export function createWorkflowServer({ name, version, definitions, run, scope }) {
  const server = new McpServer({ name, version });
  for (const [tool, definition] of Object.entries(definitions)) {
    server.registerTool(tool, {
      description: definition.description,
      inputSchema: definition.input,
      ...(definition.output ? { outputSchema: definition.output } : {}),
      annotations: {
        readOnlyHint: definition.effect === 'read',
        destructiveHint: false,
        idempotentHint: definition.effect === 'read',
        openWorldHint: scope !== 'controlled_lab_only',
      },
    }, async input => {
      try {
        const result = await run(tool, input);
        return { content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result };
      } catch (error) {
        return { isError: true, content: [{ type: 'text', text: JSON.stringify({ error: { code: error instanceof WorkflowError ? error.code : 'INTERNAL_ERROR' } }) }] };
      }
    });
  }
  return server;
}
