import { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import { actions } from './operations.js';
import { guarded } from './results.js';

const requiredText = (max) => z.string().trim().min(1).max(max);
const textList = (items = 40, chars = 1500) => z.array(requiredText(chars)).max(items).default([]);
const readOnly = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false
};
const localWrite = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: false
};

export const TOOL_NAMES = [
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

export function createAutocacheMcpServer() {
  const server = new McpServer({
    name: 'autocache-local-hosts',
    version: '0.1.0'
  });

  server.registerTool('autocache_status', {
    title: 'AutoCache Status',
    description: 'Read bounded health and continuity counts from the configured local AutoCache store. This hookless bridge does not capture lifecycle events automatically.',
    inputSchema: z.object({}),
    annotations: readOnly
  }, guarded(() => actions.status()));

  server.registerTool('autocache_resume', {
    title: 'AutoCache Resume',
    description: 'Read a bounded resume packet: last session summary, active breadcrumb, latest checkpoint, and due reminders. The caller must invoke this explicitly.',
    inputSchema: z.object({}),
    annotations: readOnly
  }, guarded(() => actions.resume()));

  server.registerTool('autocache_breadcrumb_start', {
    title: 'Start AutoCache Breadcrumb',
    description: 'Start one explicit local breadcrumb using AutoCache shared CLI safeguards. Refuses when another breadcrumb is already active in this store scope.',
    inputSchema: z.object({
      name: requiredText(500),
      targets: textList(30, 1000),
      planned_steps: textList(50, 1000)
    }),
    annotations: localWrite
  }, guarded((input) => actions.breadcrumbStart(input)));

  server.registerTool('autocache_breadcrumb_step', {
    title: 'Step AutoCache Breadcrumb',
    description: 'Append one explicit milestone to the active local breadcrumb. Frozen fork-chain records and missing active records are rejected by the shared CLI.',
    inputSchema: z.object({ milestone: requiredText(2000) }),
    annotations: localWrite
  }, guarded((input) => actions.breadcrumbStep(input)));

  server.registerTool('autocache_breadcrumb_complete', {
    title: 'Complete AutoCache Breadcrumb',
    description: 'Mark the active breadcrumb complete with an explicit outcome. This is a durable state transition, not proof that host lifecycle hooks ran.',
    inputSchema: z.object({ outcome: requiredText(2000) }),
    annotations: localWrite
  }, guarded((input) => actions.breadcrumbComplete(input)));

  server.registerTool('autocache_breadcrumb_abort', {
    title: 'Abort AutoCache Breadcrumb',
    description: 'Mark the active breadcrumb aborted with an explicit reason while retaining its record.',
    inputSchema: z.object({ reason: requiredText(2000) }),
    annotations: localWrite
  }, guarded((input) => actions.breadcrumbAbort(input)));

  server.registerTool('autocache_checkpoint', {
    title: 'Save AutoCache Checkpoint',
    description: 'Save an explicit bounded checkpoint to local AutoCache state. Nothing is captured unless this tool is called.',
    inputSchema: z.object({
      label: requiredText(200),
      summary: requiredText(2000),
      done: textList(),
      remaining: textList(),
      risks: textList(),
      next_action: requiredText(1500),
      files_touched: textList(50, 1500)
    }),
    annotations: localWrite
  }, guarded((input) => actions.checkpoint(input)));

  server.registerTool('autocache_handoff', {
    title: 'Save AutoCache Handoff',
    description: 'Save a local continuation packet. This tool does not send a message, notify another host, or transfer breadcrumb ownership.',
    inputSchema: z.object({
      to: requiredText(120).optional(),
      title: requiredText(300),
      done: textList(),
      remaining: textList(),
      risks: textList(),
      next_action: requiredText(1500),
      context: textList(),
      files_touched: textList(50, 1500),
      open_questions: textList(25, 1500)
    }),
    annotations: localWrite
  }, guarded((input) => actions.handoff(input)));

  server.registerTool('autocache_reminders_list', {
    title: 'List AutoCache Reminders',
    description: 'List bounded reminders from the configured local AutoCache store scope.',
    inputSchema: z.object({
      include_completed: z.boolean().default(false),
      limit: z.number().int().min(1).max(100).default(50)
    }),
    annotations: readOnly
  }, guarded((input) => actions.remindersList(input)));

  server.registerTool('autocache_reminders_add', {
    title: 'Add AutoCache Reminder',
    description: 'Add one reminder to the configured local AutoCache store. due_at is optional ISO-8601; without it the reminder is for a future explicit resume.',
    inputSchema: z.object({
      text: requiredText(1000),
      due_at: requiredText(100).optional(),
      recurring_every: requiredText(20).regex(/^\d+[smhdw]$/).optional(),
      tags: textList(20, 100)
    }),
    annotations: localWrite
  }, guarded((input) => actions.remindersAdd(input)));

  return server;
}
