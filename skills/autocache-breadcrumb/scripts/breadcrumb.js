#!/usr/bin/env node
'use strict';

// AutoCache deliberately does not require an MCP server. This CLI is the
// mutation boundary for Codex and other skill-capable surfaces that do not
// load Claude-style slash commands. It uses the same store as the hooks.

const fs = require('fs');
const path = require('path');

function parse(argv) {
  const out = { command: argv[0] || 'status', positional: [], values: {} };
  for (let i = 1; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) {
      out.positional.push(token);
      continue;
    }
    const key = token.slice(2);
    const next = argv[i + 1];
    const value = next !== undefined && !next.startsWith('--') ? argv[++i] : true;
    if (!Object.prototype.hasOwnProperty.call(out.values, key)) out.values[key] = [];
    out.values[key].push(value);
  }
  return out;
}

const parsed = parse(process.argv.slice(2));
const one = (name, fallback) => {
  const list = parsed.values[name];
  return list && list.length ? String(list[list.length - 1]) : fallback;
};
const many = (name) => (parsed.values[name] || []).map(String);
const bool = (name) => Object.prototype.hasOwnProperty.call(parsed.values, name);
const text = () => one('text', parsed.positional.join(' '));

const surface = one('surface', process.env.AUTOCACHE_SCOPE || 'codex');
process.env.AUTOCACHE_SCOPE = surface;
const store = require('../../../hooks/lib/store.js');

const command = parsed.command.toLowerCase();
const actor = one('actor', surface);
const now = () => new Date().toISOString();

function output(payload) {
  if (bool('json')) process.stdout.write(JSON.stringify(payload, null, 2) + '\n');
  else if (typeof payload === 'string') process.stdout.write(payload + '\n');
  else process.stdout.write(JSON.stringify(payload, null, 2) + '\n');
}

function fail(message) {
  process.stderr.write('AutoCache: ' + message + '\n');
  process.exitCode = 1;
  return null;
}

function current() {
  return store.activeBreadcrumb();
}

function requireCurrent() {
  const bc = current();
  if (!bc) return fail('no open breadcrumb');
  if (store.isFrozen(bc)) return fail(store.frozenNotice(bc));
  return bc;
}

function writeRecord(bc) {
  const clean = Object.assign({}, bc);
  delete clean.__autocache_source;
  clean.updated_at = now();
  if (!clean.id) return fail('breadcrumb has no id');
  if (!store.writeJSON('breadcrumbs/' + store.safeName(clean.id) + '.json', clean)) {
    return fail('could not write breadcrumb ' + clean.id);
  }
  return clean;
}

function activate(id) {
  const at = now();
  if (!store.writeJSON('breadcrumbs/active.json', {
    version: 1,
    breadcrumb_id: id || null,
    updated_at: at
  })) return fail('could not update the active breadcrumb pointer');
  return true;
}

function render(bc) {
  const progress = store.breadcrumbProgress(bc);
  return {
    id: bc.id,
    status: bc.status || 'open',
    name: bc.name || bc.title || '',
    targets: Array.isArray(bc.targets) ? bc.targets : [],
    completed: progress.completed,
    remaining: progress.remaining,
    decisions: Array.isArray(bc.decisions) ? bc.decisions : [],
    forked_from: bc.forked_from || null,
    forked_to: bc.forked_to || null,
    updated_at: bc.updated_at || null
  };
}

function listRecent() {
  try {
    const dir = store.resolvePath('breadcrumbs');
    return fs.readdirSync(dir)
      .filter((name) => name.endsWith('.json') && name !== 'active.json' && !name.includes('.bak-'))
      .map((name) => ({ name, mtime: fs.statSync(path.join(dir, name)).mtimeMs }))
      .sort((a, b) => b.mtime - a.mtime)
      .slice(0, 20)
      .map((item) => store.readJSON('breadcrumbs/' + item.name, null))
      .filter(Boolean)
      .map(render);
  } catch (e) {
    return [];
  }
}

function blockedDecision(bc, milestone) {
  const planned = Array.isArray(bc.planned_steps) ? bc.planned_steps : [];
  const lower = milestone.toLowerCase();
  for (const decision of store.openDecisions(bc)) {
    for (const raw of (Array.isArray(decision.blocks) ? decision.blocks : [])) {
      const index = Number(raw);
      const plannedText = planned[index];
      if (plannedText && lower.includes(String(plannedText).toLowerCase().slice(0, 24))) {
        return { decision, index, planned: plannedText };
      }
    }
  }
  return null;
}

if (command === 'help' || command === '--help' || command === '-h') {
  output([
    'AutoCache breadcrumb CLI',
    '',
    'start    --name TEXT [--target PATH]... [--planned TEXT]...',
    'step     --text TEXT',
    'add      --text TEXT',
    'decide   --question TEXT --option TEXT --option TEXT [--lean TEXT] [--waits-on user|any_informed_session] [--block N]...',
    'resolve  --id ID --chosen TEXT [--decided-by user|SURFACE] [--basis TEXT]',
    'status   [--json]',
    'complete --text OUTCOME',
    'abort    --text REASON',
    'list     [--json]',
    'adopt    --id ID',
    'fork     --id ID',
    'retire   --id ID --reason TEXT',
    'backup',
    '',
    'Common options: --surface codex --actor NAME --session-id ID --json'
  ].join('\n'));
} else if (command === 'start') {
  if (current()) fail('a breadcrumb is already open; complete, abort, or fork it first');
  else {
    const name = one('name', text());
    if (!name) fail('start requires --name');
    else {
      const id = store.shortId('bc');
      const at = now();
      const record = {
        version: 1,
        id,
        name,
        status: 'open',
        created_at: at,
        updated_at: at,
        cwd: process.cwd(),
        surface,
        session_id: one('session-id', null),
        targets: many('target'),
        planned_steps: many('planned'),
        steps: [],
        decisions: [],
        tool_calls: 0,
        completed_at: null,
        outcome: null
      };
      const saved = writeRecord(record);
      if (saved && activate(id)) {
        store.appendEvent({ event: 'breadcrumb_start', breadcrumb_id: id, surface, actor });
        output(render(saved));
      }
    }
  }
} else if (command === 'step') {
  const bc = requireCurrent();
  const milestone = text();
  if (bc && !milestone) fail('step requires milestone text');
  else if (bc) {
    const blocked = blockedDecision(bc, milestone);
    if (blocked) fail('planned step ' + blocked.index + ' is blocked by decision ' + blocked.decision.id);
    else {
      bc.steps = Array.isArray(bc.steps) ? bc.steps : [];
      bc.steps.push({ at: now(), text: milestone, source: 'cli', actor });
      const saved = writeRecord(bc);
      if (saved) {
        store.appendEvent({ event: 'breadcrumb_step', breadcrumb_id: saved.id, step: saved.steps.length, surface, actor });
        output(render(saved));
      }
    }
  }
} else if (command === 'add') {
  const bc = requireCurrent();
  const pending = text();
  if (bc && !pending) fail('add requires pending-step text');
  else if (bc) {
    bc.planned_steps = Array.isArray(bc.planned_steps) ? bc.planned_steps : [];
    bc.planned_steps.push(pending);
    const saved = writeRecord(bc);
    if (saved) {
      store.appendEvent({ event: 'breadcrumb_add_step', breadcrumb_id: saved.id, index: saved.planned_steps.length - 1, surface, actor });
      output(render(saved));
    }
  }
} else if (command === 'decide') {
  const bc = requireCurrent();
  const question = one('question', text());
  const options = many('option').slice(0, 3);
  if (bc && (!question || options.length < 2)) fail('decide requires --question and two or three --option values');
  else if (bc) {
    bc.decisions = Array.isArray(bc.decisions) ? bc.decisions : [];
    const id = 'dec-' + (bc.decisions.length + 1) + '-' + store.shortId('d').slice(-4);
    const blocks = many('block').map(Number).filter((n) => Number.isInteger(n) && n >= 0);
    bc.decisions.push({
      id,
      question,
      options,
      lean: one('lean', null),
      waits_on: one('waits-on', 'user') === 'any_informed_session' ? 'any_informed_session' : 'user',
      blocks,
      status: 'open',
      raised_at: now(),
      raised_by: actor,
      chosen: null,
      decided_by: null,
      basis: null,
      decided_at: null
    });
    const saved = writeRecord(bc);
    if (saved) {
      store.appendEvent({ event: 'breadcrumb_decision_raise', breadcrumb_id: saved.id, decision_id: id, surface, actor });
      output(render(saved));
    }
  }
} else if (command === 'resolve') {
  const bc = requireCurrent();
  const id = one('id', '');
  const chosen = one('chosen', text());
  const decidedBy = one('decided-by', actor);
  const basis = one('basis', '');
  const decision = bc && (Array.isArray(bc.decisions) ? bc.decisions : []).find((item) => item && item.id === id);
  if (bc && !decision) fail('no open decision ' + id);
  else if (decision && (decision.status === 'resolved' || decision.chosen)) fail(id + ' is already resolved');
  else if (decision && decision.waits_on === 'user' && decidedBy !== 'user') fail(id + ' waits on the user');
  else if (decision && decision.waits_on === 'any_informed_session' && !basis) fail(id + ' requires a recorded basis');
  else if (decision && !chosen) fail('resolve requires --chosen');
  else if (decision) {
    decision.status = 'resolved';
    decision.chosen = chosen;
    decision.decided_by = decidedBy;
    decision.basis = basis || null;
    decision.decided_at = now();
    const saved = writeRecord(bc);
    if (saved) {
      store.appendEvent({ event: 'breadcrumb_decision_resolve', breadcrumb_id: saved.id, decision_id: id, surface, actor });
      output(render(saved));
    }
  }
} else if (command === 'complete' || command === 'abort') {
  const bc = requireCurrent();
  const outcome = text();
  if (bc && !outcome) fail(command + ' requires an outcome or reason');
  else if (bc) {
    const at = now();
    bc.status = command === 'complete' ? 'complete' : 'aborted';
    bc.completed_at = at;
    if (command === 'abort') bc.aborted_at = at;
    bc.outcome = outcome;
    const saved = writeRecord(bc);
    if (saved && activate(null)) {
      const ancestors = command === 'complete' ? store.propagateCompletion(saved) : [];
      store.appendEvent({ event: 'breadcrumb_' + command, breadcrumb_id: saved.id, surface, actor });
      output(Object.assign(render(saved), { ancestors_completed: ancestors }));
    }
  }
} else if (command === 'adopt') {
  const id = one('id', parsed.positional[0] || '');
  const existing = store.readBreadcrumb(id);
  if (!existing) fail('no breadcrumb ' + id);
  else if (store.isFrozen(existing)) fail(store.frozenNotice(existing));
  else if (current() && current().id !== id) fail('another breadcrumb is already open');
  else {
    existing.status = 'open';
    existing.completed_at = null;
    existing.aborted_at = null;
    existing.adopted_at = now();
    existing.adopted_by = actor;
    const saved = writeRecord(existing);
    if (saved && activate(id)) output(render(saved));
  }
} else if (command === 'fork') {
  const id = one('id', parsed.positional[0] || (current() && current().id) || '');
  const result = store.forkBreadcrumb(id, {
    by: actor,
    surface,
    session_id: one('session-id', null),
    cwd: process.cwd(),
    activate: true
  });
  if (!result.ok) fail(result.error);
  else output(render(result.record));
} else if (command === 'retire') {
  const id = one('id', parsed.positional[0] || '');
  const reason = one('reason', text());
  if (!id || !reason) fail('retire requires --id and --reason');
  else {
    const retired = store.retireChain(id, reason, actor);
    if (!retired.length) fail('no open records retired');
    else {
      const active = current();
      if (active && retired.includes(active.id)) activate(null);
      output({ retired, reason });
    }
  }
} else if (command === 'backup') {
  const bc = requireCurrent();
  if (bc) {
    const stamp = now().replace(/[-:.]/g, '');
    const rel = 'breadcrumbs/' + store.safeName(bc.id) + '.bak-' + stamp + '.json';
    const clean = Object.assign({}, bc);
    delete clean.__autocache_source;
    if (!store.writeJSON(rel, clean)) fail('could not back up ' + bc.id);
    else output({ breadcrumb_id: bc.id, backup: store.resolvePath(rel) });
  }
} else if (command === 'status') {
  const bc = current();
  output(bc ? render(bc) : { status: 'idle', breadcrumb: null, scope: store.storeScope() });
} else if (command === 'list') {
  output(listRecent());
} else {
  fail('unknown command ' + command);
}
