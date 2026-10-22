import test from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createWorkflowServer } from '../src/mcp-core.mjs';
import { WorkflowError } from '../src/contracts.mjs';

const definition = {
  input: z.object({ text: z.string() }).strict(),
  output: z.object({ data: z.object({ text: z.string() }).strict(), evidence: z.object({ cached: z.boolean() }).strict() }).strict(),
  effect: 'read',
  description: 'Echo a string.',
};

async function pair(run) {
  const server = createWorkflowServer({ name: 'test', version: '1', definitions: { echo_read: definition }, run, scope: 'verified_reads' });
  const client = new Client({ name: 'test-client', version: '1' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return { client, server };
}

test('MCP exposes typed read-only tools and returns structured content', async t => {
  const { client, server } = await pair(async (name, input) => ({ data: { text: input.text }, evidence: { cached: false } }));
  t.after(() => Promise.all([client.close(), server.close()]));
  const { tools } = await client.listTools();
  assert.deepEqual(tools.map(tool => tool.name), ['echo_read']);
  assert.equal(tools[0].annotations.readOnlyHint, true);
  const result = await client.callTool({ name: 'echo_read', arguments: { text: 'hola' } });
  assert.equal(result.isError, undefined);
  assert.equal(result.structuredContent.data.text, 'hola');
});

test('MCP maps workflow errors to a stable code without upstream details', async t => {
  const { client, server } = await pair(async () => { throw new WorkflowError('REAUTH_REQUIRED', 401); });
  t.after(() => Promise.all([client.close(), server.close()]));
  const result = await client.callTool({ name: 'echo_read', arguments: { text: 'hola' } });
  assert.equal(result.isError, true);
  assert.deepEqual(JSON.parse(result.content[0].text), { error: { code: 'REAUTH_REQUIRED' } });
});
