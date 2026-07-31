---
description: Track a multi-step work arc - start, step, status, complete, abort, list, adopt, backup
allowed-tools: ["Bash", "Read", "Write", "Glob"]
---

# /breadcrumb

A breadcrumb is the record of an arc in progress: what you set out to do, which files
it touches, and every milestone actually reached. The `PostToolUse` hook appends to the
open one automatically; this command is for the deliberate moves.

One open breadcrumb at a time. `breadcrumbs/active.json` points at it.

Arguments: `$ARGUMENTS`
- `start <name>` - open one. Name it so another agent knows the component and the files.
- `step <text>` - log a milestone that is actually finished
- `status` - the open one, its steps, and what is still planned
- `complete [outcome]` - close it as done
- `abort [reason]` - close it as abandoned; say why
- `list` - recent breadcrumbs, newest first
- `adopt <id>` - re-open a breadcrumb another session left behind
- `backup` - snapshot the open breadcrumb before a risky edit
- bare text with no verb - treat as `step` if one is open, otherwise `start`

## Naming rule

`start` names must declare the component and the mutable targets:

    auth token refresh | targets: src/auth/session.ts, src/auth/refresh.ts

Not `fix bug`, not `cleanup`, not `update files`. The name is what the next session
reads first. Pass `targets` and `planned_steps` at start when you know them - planned
steps are what `/resume` diffs against to report what is still open.

## Run

Set `MODE` and the relevant fields, write to a temp file, run `node "<path>"`.

```js
const fs = require('fs'), path = require('path'), os = require('os'), crypto = require('crypto');

const MODE = "status";      // start | step | status | complete | abort | list | adopt | backup
const NAME = "";            // start
const TARGETS = [];         // start: absolute or repo-relative paths
const PLANNED = [];         // start: the steps you expect to take
const TEXT = "";            // step: what was finished; complete/abort: outcome or reason
const TARGET_ID = "";       // adopt

const HOME = process.env.AUTOCACHE_HOME || path.join(os.homedir(), '.autocache');
const DIR = path.join(HOME, 'breadcrumbs');
const now = new Date().toISOString();
const rd = f => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { return null; } };
const wr = (f, obj) => { fs.mkdirSync(path.dirname(f), { recursive: true }); const t = f + '.tmp'; fs.writeFileSync(t, JSON.stringify(obj, null, 2)); fs.renameSync(t, f); return f; };
const ev = (event, data) => { try { const l = path.join(HOME, 'logs', 'events.jsonl'); fs.mkdirSync(path.dirname(l), { recursive: true }); fs.appendFileSync(l, JSON.stringify({ at: now, event: event, surface: 'claude-code', data: data || {} }) + '\n'); } catch (e) { } };
const activeFile = path.join(DIR, 'active.json');
const act = rd(activeFile);
const openId = act && (act.breadcrumb_id || act.id || null);
const bcFile = id => path.join(DIR, id + '.json');
const openBc = openId ? rd(bcFile(openId)) : null;
const render = b => {
  console.log(b.id + '  [' + (b.status || 'open') + ']  ' + (b.name || '(unnamed)'));
  if (b.targets && b.targets.length) console.log('  targets: ' + b.targets.join(', '));
  console.log('  started ' + (b.created_at || '?') + (b.completed_at ? '  ended ' + b.completed_at : ''));
  (b.steps || []).forEach((s, i) => console.log('  ' + (i + 1) + '. ' + (s.text || JSON.stringify(s)) + '   ' + (s.at || '')));
  if (b.planned_steps && b.planned_steps.length) {
    const done = (b.steps || []).map(s => String(s.text || '').toLowerCase());
    const open = b.planned_steps.filter(p => !done.some(d => d.includes(String(p).toLowerCase().slice(0, 24))));
    if (open.length) { console.log('  still planned:'); open.forEach(p => console.log('    - ' + p)); }
  }
  if (b.outcome) console.log('  outcome: ' + b.outcome);
};

if (MODE === 'start') {
  if (openBc && openBc.status !== 'complete' && openBc.status !== 'aborted') {
    console.log('ALREADY OPEN: ' + openBc.id + '  ' + (openBc.name || ''));
    console.log('complete or abort it first, or log a step against it instead.');
    process.exit(0);
  }
  const id = 'bc-' + now.replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z') + '-' + crypto.randomBytes(3).toString('hex');
  const idxRaw = rd(path.join(HOME, 'sessions', 'index.json'));
  const index = Array.isArray(idxRaw) ? idxRaw : ((idxRaw && idxRaw.sessions) || []);
  const bc = { id: id, name: NAME, status: 'open', created_at: now, updated_at: now, cwd: process.cwd(), surface: 'claude-code', session_id: index[0] ? (index[0].id || index[0]) : null, targets: TARGETS, planned_steps: PLANNED, steps: [], completed_at: null, outcome: null };
  wr(bcFile(id), bc);
  wr(activeFile, { breadcrumb_id: id, updated_at: now });
  ev('breadcrumb.start', { id: id, name: NAME });
  console.log('opened ' + id);
} else if (MODE === 'step') {
  if (!openBc) { console.log('no open breadcrumb - start one first'); process.exit(0); }
  openBc.steps = openBc.steps || [];
  openBc.steps.push({ at: now, text: TEXT, source: 'command' });
  openBc.updated_at = now;
  wr(bcFile(openBc.id), openBc);
  ev('breadcrumb.step', { id: openBc.id, n: openBc.steps.length });
  console.log('step ' + openBc.steps.length + ' logged on ' + openBc.id);
} else if (MODE === 'complete' || MODE === 'abort') {
  if (!openBc) { console.log('no open breadcrumb'); process.exit(0); }
  openBc.status = MODE === 'complete' ? 'complete' : 'aborted';
  openBc.completed_at = now;
  openBc.updated_at = now;
  openBc.outcome = TEXT || null;
  wr(bcFile(openBc.id), openBc);
  wr(activeFile, { breadcrumb_id: null, updated_at: now });
  ev('breadcrumb.' + MODE, { id: openBc.id });
  console.log(MODE + 'd ' + openBc.id + ' after ' + (openBc.steps || []).length + ' step(s)');
} else if (MODE === 'adopt') {
  const b = rd(bcFile(TARGET_ID));
  if (!b) { console.log('no breadcrumb ' + TARGET_ID); process.exit(0); }
  if (openBc && openBc.id !== b.id && openBc.status === 'open') { console.log('close ' + openBc.id + ' first'); process.exit(0); }
  b.status = 'open';
  b.completed_at = null;
  b.adopted_at = now;
  b.adopted_by = 'claude-code';
  b.updated_at = now;
  wr(bcFile(b.id), b);
  wr(activeFile, { breadcrumb_id: b.id, updated_at: now });
  ev('breadcrumb.adopt', { id: b.id });
  render(b);
} else if (MODE === 'backup') {
  if (!openBc) { console.log('no open breadcrumb'); process.exit(0); }
  const f = bcFile(openBc.id).replace(/\.json$/, '.bak-' + now.replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z') + '.json');
  wr(f, openBc);
  console.log('backed up to ' + f);
} else if (MODE === 'list') {
  let files = [];
  try { files = fs.readdirSync(DIR).filter(f => f.endsWith('.json') && f !== 'active.json' && !f.includes('.bak-')).map(f => ({ f, m: fs.statSync(path.join(DIR, f)).mtimeMs })).sort((a, b) => b.m - a.m).slice(0, 20); } catch (e) { }
  if (!files.length) { console.log('no breadcrumbs yet'); process.exit(0); }
  files.forEach(x => { const b = rd(path.join(DIR, x.f)) || {}; console.log([(b.id || x.f), '[' + (b.status || '?') + ']', ((b.steps || []).length) + ' step(s)', (b.name || '')].join('  ')); });
} else {
  if (!openBc) { console.log('no open breadcrumb'); process.exit(0); }
  render(openBc);
}
```

## Discipline

- Log a step when a milestone is genuinely finished, not when you start it.
- `complete` requires an outcome. `abort` requires a reason - an aborted arc with no
  reason is worse than no record.
- Before `complete`, check the files the breadcrumb targets actually contain the change.
  Steps are claims; the files are the evidence.
- If `start` reports one already open and it belongs to abandoned work, `abort` it with
  the reason rather than opening a second.
