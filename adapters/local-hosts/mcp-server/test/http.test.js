import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';

const TOOL_NAMES = [
  'autocache_status',
  'autocache_resume',
  'autocache_breadcrumb_start',
  'autocache_breadcrumb_step',
  'autocache_breadcrumb_complete',
  'autocache_breadcrumb_abort',
  'autocache_checkpoint',
  'autocache_handoff',
  'autocache_reminders_list',
  'autocache_reminders_add'
];

function body(result) {
  assert.equal(result.isError, undefined, JSON.stringify(result));
  assert.equal(result.content?.[0]?.type, 'text');
  return JSON.parse(result.content[0].text);
}

test('official SDK client uses authenticated Streamable HTTP', { timeout: 30_000 }, async (t) => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'autocache-mcp-http-'));
  process.env.AUTOCACHE_HOME = home;
  process.env.AUTOCACHE_STORE_SCOPE = 'open-webui-test';
  process.env.AUTOCACHE_SCOPE = 'open-webui-test';
  process.env.AUTOCACHE_MCP_ACTOR = 'open-webui-test';

  const { startHttpServer } = await import('../src/http.js');
  const token = 'test-only-token-123456789';
  const running = await startHttpServer({
    env: {
      ...process.env,
      AUTOCACHE_MCP_HOST: '127.0.0.1',
      AUTOCACHE_MCP_PORT: '0',
      AUTOCACHE_MCP_TOKEN: token
    },
    logger: () => {}
  });
  const transport = new StreamableHTTPClientTransport(running.url, {
    requestInit: { headers: { Authorization: `Bearer ${token}` } }
  });
  const client = new Client({ name: 'autocache-http-test', version: '1.0.0' });

  t.after(async () => {
    try { await client.close(); } catch { /* already closed */ }
    try { await running.close(); } catch { /* already closed */ }
    fs.rmSync(home, { recursive: true, force: true });
  });

  const denied = await fetch(running.url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} })
  });
  assert.equal(denied.status, 401);

  const deniedOrigin = await fetch(running.url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Origin: 'https://untrusted.example'
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} })
  });
  assert.equal(deniedOrigin.status, 403);

  const oversized = await fetch(running.url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: 'x'.repeat(129 * 1024)
  });
  assert.equal(oversized.status, 413);

  await client.connect(transport);
  const listed = await client.listTools();
  assert.deepEqual(listed.tools.map((tool) => tool.name).sort(), [...TOOL_NAMES].sort());

  const status = body(await client.callTool({ name: 'autocache_status', arguments: {} }));
  assert.equal(status.scope, 'open-webui-test');
  assert.equal(status.automatic_lifecycle_capture, false);

  body(await client.callTool({
    name: 'autocache_reminders_add',
    arguments: { text: 'Streamable HTTP reached shared state' }
  }));
  const listedReminders = body(await client.callTool({
    name: 'autocache_reminders_list',
    arguments: { limit: 5 }
  }));
  assert.equal(listedReminders.reminders[0].text, 'Streamable HTTP reached shared state');

  const health = await fetch(new URL('/health', running.url));
  assert.equal(health.status, 200);
  const healthBody = await health.json();
  assert.equal(healthBody.transport, 'streamable-http');
});

test('non-loopback HTTP fails closed without auth, Host, and Origin policy', async () => {
  const { startHttpServer } = await import('../src/http.js');
  await assert.rejects(
    startHttpServer({
      env: { AUTOCACHE_MCP_HOST: '0.0.0.0', AUTOCACHE_MCP_PORT: '0' },
      logger: () => {}
    }),
    /requires AUTOCACHE_MCP_TOKEN/
  );
  await assert.rejects(
    startHttpServer({
      env: {
        AUTOCACHE_MCP_HOST: '0.0.0.0',
        AUTOCACHE_MCP_PORT: '0',
        AUTOCACHE_MCP_TOKEN: 'test-only-token-123456789',
        AUTOCACHE_MCP_ALLOWED_HOSTS: 'host.docker.internal'
      },
      logger: () => {}
    }),
    /requires AUTOCACHE_MCP_ALLOWED_ORIGINS/
  );
  await assert.rejects(
    startHttpServer({
      env: {
        AUTOCACHE_MCP_HOST: '0.0.0.0',
        AUTOCACHE_MCP_PORT: '0',
        AUTOCACHE_MCP_TOKEN: 'test-only-token-123456789',
        AUTOCACHE_MCP_ALLOWED_HOSTS: 'host.docker.internal',
        AUTOCACHE_MCP_ALLOWED_ORIGINS: 'not-an-origin'
      },
      logger: () => {}
    }),
    /must be absolute http:\/\//
  );
});
