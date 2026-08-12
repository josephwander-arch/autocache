import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';

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

const cliPath = fileURLToPath(new URL('../src/cli.js', import.meta.url));
const packageRoot = fileURLToPath(new URL('..', import.meta.url));

function body(result) {
  assert.equal(result.isError, undefined, JSON.stringify(result));
  assert.equal(result.content?.[0]?.type, 'text');
  return JSON.parse(result.content[0].text);
}

test('official SDK client exercises every tool over stdio', { timeout: 30_000 }, async (t) => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'autocache-mcp-stdio-'));
  const env = {
    ...process.env,
    AUTOCACHE_HOME: home,
    AUTOCACHE_STORE_SCOPE: 'transport-shared',
    AUTOCACHE_SCOPE: 'transport-shared',
    AUTOCACHE_MCP_ACTOR: 'lm-studio-test',
    AUTOCACHE_WORKSPACE: packageRoot
  };
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [cliPath, 'stdio'],
    cwd: packageRoot,
    env,
    stderr: 'pipe',
    maxBufferSize: 1024 * 1024
  });
  const client = new Client({ name: 'autocache-stdio-test', version: '1.0.0' });

  t.after(async () => {
    try { await client.close(); } catch { /* already closed */ }
    fs.rmSync(home, { recursive: true, force: true });
  });

  await client.connect(transport);
  const listed = await client.listTools();
  assert.deepEqual(listed.tools.map((tool) => tool.name).sort(), [...TOOL_NAMES].sort());

  const status = body(await client.callTool({ name: 'autocache_status', arguments: {} }));
  assert.equal(status.ok, true);
  assert.equal(status.scope, 'transport-shared');
  assert.equal(status.automatic_lifecycle_capture, false);

  const started = body(await client.callTool({
    name: 'autocache_breadcrumb_start',
    arguments: {
      name: 'stdio integration',
      targets: ['scratch-state'],
      planned_steps: ['exercise explicit tools']
    }
  }));
  assert.equal(started.breadcrumb.status, 'open');

  const stepped = body(await client.callTool({
    name: 'autocache_breadcrumb_step',
    arguments: { milestone: 'exercised explicit tools' }
  }));
  assert.equal(stepped.breadcrumb.completed.at(-1), 'exercised explicit tools');

  const checkpoint = body(await client.callTool({
    name: 'autocache_checkpoint',
    arguments: {
      label: 'transport smoke',
      summary: 'stdio client reached the AutoCache bridge',
      done: ['listed tools'],
      remaining: ['complete breadcrumb'],
      risks: [],
      next_action: 'complete breadcrumb',
      files_touched: []
    }
  }));
  assert.match(checkpoint.checkpoint.id, /^ckpt_/);

  const handoff = body(await client.callTool({
    name: 'autocache_handoff',
    arguments: {
      to: 'next-local-host',
      title: 'stdio smoke packet',
      done: ['stdio transport works'],
      remaining: [],
      risks: [],
      next_action: 'read status',
      context: [],
      files_touched: [],
      open_questions: []
    }
  }));
  assert.equal(handoff.handoff.delivery, 'local-state-only');

  const added = body(await client.callTool({
    name: 'autocache_reminders_add',
    arguments: { text: 'verify shared local-host scope', tags: ['test'] }
  }));
  assert.match(added.reminder.id, /^rem_/);

  const reminders = body(await client.callTool({
    name: 'autocache_reminders_list',
    arguments: { include_completed: false, limit: 10 }
  }));
  assert.equal(reminders.reminders.length, 1);

  const resumed = body(await client.callTool({ name: 'autocache_resume', arguments: {} }));
  assert.equal(resumed.active_breadcrumb.id, started.breadcrumb.id);
  assert.equal(resumed.latest_checkpoint.id, checkpoint.checkpoint.id);
  assert.equal(resumed.reminders_due[0].text, 'verify shared local-host scope');
  assert.equal(resumed.reminders_due[0].due_at, null);

  const completed = body(await client.callTool({
    name: 'autocache_breadcrumb_complete',
    arguments: { outcome: 'stdio smoke passed' }
  }));
  assert.equal(completed.breadcrumb.status, 'complete');

  body(await client.callTool({
    name: 'autocache_breadcrumb_start',
    arguments: { name: 'abort path', targets: [], planned_steps: [] }
  }));
  const aborted = body(await client.callTool({
    name: 'autocache_breadcrumb_abort',
    arguments: { reason: 'intentional transport test' }
  }));
  assert.equal(aborted.breadcrumb.status, 'aborted');
});
