---
description: Track a multi-step work arc - start, step, add, decide, resolve, status, complete, abort, list, adopt, fork, retire, backup
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
- `add <text>` - append still-open work as a pending step (see the boundary rule below)
- `decide <question>` - raise an awaiting-decision entry: 2-3 options, optional lean,
  who it waits on, which planned steps it blocks
- `resolve <decision-id> <chosen>` - resolve a decision, recording who decided and on
  what basis
- `status` - the open one, its steps, decisions, chain position, and what is still planned
- `complete [outcome]` - close it as done; closing a chain head also closes every
  still-open ancestor as `completed_via` this record
- `abort [reason]` - close it as abandoned; say why
- `list` - recent breadcrumbs, newest first
- `adopt <id>` - re-open a breadcrumb another session left behind (never a frozen one)
- `fork <id>` - take over a live head: a new breadcrumb carries the remaining steps and
  open decisions, and the source freezes
- `retire <id> <reason>` - close out an incomplete chain that should stop surfacing;
  the reason is recorded
- `backup` - snapshot the open breadcrumb before a risky edit
- bare text with no verb - treat as `step` if one is open, otherwise `start`

## Naming rule

`start` names must declare the component and the mutable targets:

    auth token refresh | targets: src/auth/session.ts, src/auth/refresh.ts

Not `fix bug`, not `cleanup`, not `update files`. The name is what the next session
reads first. Pass `targets` and `planned_steps` at start when you know them - planned
steps are what `/resume` diffs against to report what is still open.

## Pending steps: the boundary rule

The planned list is not fixed at start; it grows as work surfaces mid-operation.

- Discovered **and finished before your current output ends**: no entry. A micro-fix
  folds into the milestone it belongs to.
- **Still open when your output ends**: it MUST be appended with `add`. Unrecorded
  open work is invisible to the next session, and invisible work does not get done.

## Decisions

`decide` records a question the arc cannot settle by itself: 2-3 options, an optional
lean, and `waits_on` - `"user"` when only the user can answer, `"any_informed_session"`
when any agent with the full recorded picture may call it. `blocks` lists the
`planned_steps` indexes that must not be worked until the decision resolves; everything
not blocked proceeds freely. `resolve` records `chosen`, `decided_by`, `basis` (what
justified the call), and `decided_at`. A `waits_on: "user"` decision resolves only with
the user's actual answer.

## The chain rule

`fork` is the takeover move: it writes a new record carrying the remaining planned
steps and unresolved decisions (block indexes reindexed), sets `forked_from` on the new
record, then marks the source `forked_to` / `forked_by` / `forked_at`. The source is
now **frozen** - every write against it is rejected with a message naming the chain
head. Exactly one live head exists per chain; taking work back means forking the
current head, so the chain grows and every hop stays attributed. Before forking work
another session may still hold, apply the takeover eligibility ladder in the
`autocache-handoff` skill.

## Native worker result

A bounded native worker does not take ownership and does not get a breadcrumb
fork. Its stop hook writes an immutable receipt under `workers/` and gives the
lead an exact marker. After independently verifying the worker's output, log the
lead-owned milestone with the marker in the step text:

    verified parser worker: 17/17 focused tests [worker:wr_20260811T130000Z_a1b2c3]

SessionStart keeps resurfacing the latest unreconciled result for each worker
until that exact marker appears in a breadcrumb step. The marker records that
the lead reviewed and incorporated the result; it is never a substitute for the
verification text beside it.

## Run

Set `MODE` and the relevant fields, write to a temp file, run `node "<path>"`.

```js
const fs = require('fs'), path = require('path'), os = require('os'), crypto = require('crypto');

const MODE = "status";      // start | step | add | decide | resolve | status | complete | abort | list | adopt | fork | retire | backup
const NAME = "";            // start
const TARGETS = [];         // start: absolute or repo-relative paths
const PLANNED = [];         // start: the steps you expect to take
const TEXT = "";            // step: what was finished; add: the pending item; complete/abort: outcome or reason; retire: the recorded reason
const TARGET_ID = "";       // adopt | fork | retire
const DECISION = { question: "", options: [], lean: null, waits_on: "user", blocks: [] };   // decide
const RESOLVE = { id: "", chosen: "", decided_by: "", basis: "" };                          // resolve

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
const mkId = () => 'bc-' + now.replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z') + '-' + crypto.randomBytes(3).toString('hex');
const frozen = b => !!(b && b.forked_to);
const headOf = b => { let c = b; const seen = {}; while (c && c.forked_to && c.id && !seen[c.id]) { seen[c.id] = 1; c = rd(bcFile(c.forked_to)); } return c; };
const freezeMsg = b => { const h = headOf(b); return b.id + ' is FROZEN: forked to ' + b.forked_to + (b.forked_by ? ' by ' + b.forked_by : '') + (b.forked_at ? ' at ' + b.forked_at : '') + '. Chain head: ' + (h ? h.id + ' [' + (h.status || 'open') + ']' : b.forked_to + ' (record missing)') + ' - catch up there before continuing.'; };
const openDecs = b => ((b && b.decisions) || []).filter(d => d && d.status !== 'resolved' && !d.chosen);
const blockedMap = b => { const m = {}; openDecs(b).forEach(d => (d.blocks || []).forEach(i => { m[i] = d; })); return m; };
const rejectFrozen = b => { if (frozen(b)) { console.log(freezeMsg(b)); process.exit(0); } };
const render = b => {
  console.log(b.id + '  [' + (b.status || 'open') + ']  ' + (b.name || '(unnamed)'));
  if (b.targets && b.targets.length) console.log('  targets: ' + b.targets.join(', '));
  console.log('  started ' + (b.created_at || '?') + (b.completed_at ? '  ended ' + b.completed_at : ''));
  if (b.forked_from) console.log('  forked from ' + b.forked_from);
  if (b.forked_to) console.log('  FROZEN -> forked to ' + b.forked_to + (b.forked_by ? ' by ' + b.forked_by : '') + (b.forked_at ? ' at ' + b.forked_at : ''));
  if (b.completed_via) console.log('  completed via ' + b.completed_via);
  (b.steps || []).forEach((s, i) => console.log('  ' + (i + 1) + '. ' + (s.text || JSON.stringify(s)) + '   ' + (s.at || '')));
  (b.decisions || []).forEach(d => {
    if (d.status === 'resolved' || d.chosen) console.log('  decision ' + d.id + ' [resolved] ' + d.question + ' -> ' + d.chosen + ' (by ' + (d.decided_by || '?') + (d.basis ? ', basis: ' + d.basis : '') + ')');
    else console.log('  decision ' + d.id + ' [open] ' + d.question + ' | options: ' + (d.options || []).join(' / ') + (d.lean ? ' | lean: ' + d.lean : '') + ' | waits on ' + (d.waits_on || 'user') + ((d.blocks || []).length ? ' | blocks planned ' + d.blocks.join(', ') : ''));
  });
  if (b.planned_steps && b.planned_steps.length) {
    const done = (b.steps || []).map(s => String(s.text || '').toLowerCase());
    const blk = blockedMap(b);
    const open = [];
    b.planned_steps.forEach((p, i) => { if (!done.some(d => d.includes(String(p).toLowerCase().slice(0, 24)))) open.push({ i: i, p: p }); });
    if (open.length) { console.log('  still planned:'); open.forEach(x => console.log('    ' + x.i + '. ' + x.p + (blk[x.i] ? '   [BLOCKED by ' + blk[x.i].id + ']' : ''))); }
  }
  if (b.outcome) console.log('  outcome: ' + b.outcome);
};

if (MODE === 'start') {
  if (openBc && openBc.status !== 'complete' && openBc.status !== 'aborted') {
    console.log('ALREADY OPEN: ' + openBc.id + '  ' + (openBc.name || ''));
    console.log('complete or abort it first, or log a step against it instead.');
    process.exit(0);
  }
  const id = mkId();
  const idxRaw = rd(path.join(HOME, 'sessions', 'index.json'));
  const index = Array.isArray(idxRaw) ? idxRaw : ((idxRaw && idxRaw.sessions) || []);
  const bc = { id: id, name: NAME, status: 'open', created_at: now, updated_at: now, cwd: process.cwd(), surface: 'claude-code', session_id: index[0] ? (index[0].id || index[0]) : null, targets: TARGETS, planned_steps: PLANNED, steps: [], decisions: [], completed_at: null, outcome: null };
  wr(bcFile(id), bc);
  wr(activeFile, { breadcrumb_id: id, updated_at: now });
  ev('breadcrumb.start', { id: id, name: NAME });
  console.log('opened ' + id);
} else if (MODE === 'step') {
  if (!openBc) { console.log('no open breadcrumb - start one first'); process.exit(0); }
  rejectFrozen(openBc);
  const blk = blockedMap(openBc);
  const hit = Object.keys(blk).find(i => { const p = openBc.planned_steps && openBc.planned_steps[i]; return p && TEXT.toLowerCase().includes(String(p).toLowerCase().slice(0, 24)); });
  if (hit !== undefined) {
    const d = blk[hit];
    console.log('BLOCKED: planned step ' + hit + ' ("' + openBc.planned_steps[hit] + '") waits on decision ' + d.id + ': ' + d.question);
    console.log(d.waits_on === 'user' ? 'Only the user can answer this one - ask, then resolve with decided_by "user".' : 'Resolve it first (any informed session may, with a recorded basis).');
    process.exit(0);
  }
  openBc.steps = openBc.steps || [];
  openBc.steps.push({ at: now, text: TEXT, source: 'command' });
  openBc.updated_at = now;
  wr(bcFile(openBc.id), openBc);
  ev('breadcrumb.step', { id: openBc.id, n: openBc.steps.length });
  console.log('step ' + openBc.steps.length + ' logged on ' + openBc.id);
} else if (MODE === 'add') {
  if (!openBc) { console.log('no open breadcrumb - start one first'); process.exit(0); }
  rejectFrozen(openBc);
  if (!TEXT) { console.log('nothing to add - pass the still-open item as TEXT'); process.exit(0); }
  openBc.planned_steps = openBc.planned_steps || [];
  openBc.planned_steps.push(TEXT);
  openBc.updated_at = now;
  wr(bcFile(openBc.id), openBc);
  ev('breadcrumb.add_step', { id: openBc.id, index: openBc.planned_steps.length - 1 });
  console.log('pending step ' + (openBc.planned_steps.length - 1) + ' appended to ' + openBc.id + ': ' + TEXT);
} else if (MODE === 'decide') {
  if (!openBc) { console.log('no open breadcrumb - start one first'); process.exit(0); }
  rejectFrozen(openBc);
  if (!DECISION.question || (DECISION.options || []).length < 2) { console.log('a decision needs a question and 2-3 options'); process.exit(0); }
  openBc.decisions = openBc.decisions || [];
  const did = 'dec-' + (openBc.decisions.length + 1) + '-' + crypto.randomBytes(2).toString('hex');
  const blocks = (DECISION.blocks || []).filter(i => Number.isInteger(i) && i >= 0);
  openBc.decisions.push({ id: did, question: DECISION.question, options: (DECISION.options || []).slice(0, 3), lean: DECISION.lean || null, waits_on: DECISION.waits_on === 'any_informed_session' ? 'any_informed_session' : 'user', blocks: blocks, status: 'open', raised_at: now, raised_by: 'claude-code', chosen: null, decided_by: null, basis: null, decided_at: null });
  openBc.updated_at = now;
  wr(bcFile(openBc.id), openBc);
  ev('breadcrumb.decision_raise', { id: openBc.id, decision: did });
  console.log('decision ' + did + ' raised on ' + openBc.id + (blocks.length ? ', blocking planned step(s) ' + blocks.join(', ') : '') + '. Unblocked steps proceed; blocked ones wait.');
} else if (MODE === 'resolve') {
  if (!openBc) { console.log('no open breadcrumb'); process.exit(0); }
  rejectFrozen(openBc);
  const d = (openBc.decisions || []).find(x => x && x.id === RESOLVE.id);
  if (!d) { console.log('no decision ' + RESOLVE.id + ' on ' + openBc.id); process.exit(0); }
  if (d.status === 'resolved' || d.chosen) { console.log(d.id + ' already resolved: ' + d.chosen + ' (by ' + (d.decided_by || '?') + ')'); process.exit(0); }
  if (d.waits_on === 'user' && RESOLVE.decided_by !== 'user') { console.log(d.id + ' waits on the user. Ask, then resolve with decided_by "user" recording their actual answer.'); process.exit(0); }
  if (d.waits_on === 'any_informed_session' && !RESOLVE.basis) { console.log('resolving ' + d.id + ' as an informed session requires a basis - say what recorded picture justified the call.'); process.exit(0); }
  d.chosen = RESOLVE.chosen; d.decided_by = RESOLVE.decided_by || 'claude-code'; d.basis = RESOLVE.basis || null; d.decided_at = now; d.status = 'resolved';
  openBc.updated_at = now;
  wr(bcFile(openBc.id), openBc);
  ev('breadcrumb.decision_resolve', { id: openBc.id, decision: d.id });
  console.log(d.id + ' resolved: ' + d.chosen + ' (by ' + d.decided_by + ')' + ((d.blocks || []).length ? ' - planned step(s) ' + d.blocks.join(', ') + ' unblocked' : ''));
} else if (MODE === 'complete' || MODE === 'abort') {
  if (!openBc) { console.log('no open breadcrumb'); process.exit(0); }
  rejectFrozen(openBc);
  openBc.status = MODE === 'complete' ? 'complete' : 'aborted';
  openBc.completed_at = now;
  openBc.updated_at = now;
  openBc.outcome = TEXT || null;
  wr(bcFile(openBc.id), openBc);
  wr(activeFile, { breadcrumb_id: null, updated_at: now });
  ev('breadcrumb.' + MODE, { id: openBc.id });
  console.log(MODE + 'd ' + openBc.id + ' after ' + (openBc.steps || []).length + ' step(s)');
  if (MODE === 'complete') {
    // Closing a head closes its ancestry: every still-open ancestor is marked
    // completed_via this record, so an earlier session resumes into a pointer,
    // not a dangling operation.
    let anc = openBc.forked_from ? rd(bcFile(openBc.forked_from)) : null;
    const seen = {}; const closed = [];
    while (anc && anc.id && !seen[anc.id]) {
      seen[anc.id] = 1;
      if (anc.status !== 'complete' && anc.status !== 'aborted') {
        anc.status = 'complete'; anc.completed_at = now; anc.completed_via = openBc.id;
        if (!anc.outcome) anc.outcome = 'completed via ' + openBc.id;
        anc.updated_at = now; wr(bcFile(anc.id), anc); closed.push(anc.id);
      }
      anc = anc.forked_from ? rd(bcFile(anc.forked_from)) : null;
    }
    if (closed.length) { ev('breadcrumb.chain_complete', { head: openBc.id, closed: closed }); console.log('chain closed: ' + closed.join(', ') + ' marked completed_via ' + openBc.id); }
  } else if (openBc.forked_from) {
    console.log('this was a chain head - its ancestors stay frozen pointing here, and this tail now surfaces as adoptable work. Retire the chain with a reason if it should stop surfacing.');
  }
} else if (MODE === 'adopt') {
  const b = rd(bcFile(TARGET_ID));
  if (!b) { console.log('no breadcrumb ' + TARGET_ID); process.exit(0); }
  if (frozen(b)) { console.log('cannot adopt ' + b.id + ': ' + freezeMsg(b) + ' Take-back means forking the head, never re-opening a frozen ancestor.'); process.exit(0); }
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
} else if (MODE === 'fork') {
  const src = rd(bcFile(TARGET_ID || openId || ''));
  if (!src) { console.log('no breadcrumb ' + (TARGET_ID || openId || '')); process.exit(0); }
  if (frozen(src)) { console.log('cannot fork ' + src.id + ': ' + freezeMsg(src) + ' Fork the head, not a frozen ancestor.'); process.exit(0); }
  if (src.status === 'complete' || src.status === 'aborted') { console.log(src.id + ' is ' + src.status + ' - only a live head can be forked'); process.exit(0); }
  const done = (src.steps || []).map(s => String(s.text || '').toLowerCase());
  const remIdx = [];
  (src.planned_steps || []).forEach((p, i) => { if (!done.some(d => d.includes(String(p).toLowerCase().slice(0, 24)))) remIdx.push(i); });
  const decs = openDecs(src);
  if (!remIdx.length && !decs.length) { console.log(src.id + ' has no remaining steps and no unresolved decisions - complete it instead of forking'); process.exit(0); }
  let nid = mkId(); let t = 0;
  while ((nid === src.id || fs.existsSync(bcFile(nid))) && t < 20) { t += 1; nid = mkId() + '-f' + t; }
  if (nid === src.id) { console.log('could not allocate a unique id for the fork'); process.exit(0); }
  const map = {}; const carried = remIdx.map((i, n) => { map[i] = n; return src.planned_steps[i]; });
  const cdec = decs.map(d => Object.assign({}, d, { blocks: (d.blocks || []).filter(i => map[i] !== undefined).map(i => map[i]) }));
  const idxRaw = rd(path.join(HOME, 'sessions', 'index.json'));
  const index = Array.isArray(idxRaw) ? idxRaw : ((idxRaw && idxRaw.sessions) || []);
  const fk = { id: nid, name: src.name, status: 'open', created_at: now, updated_at: now, cwd: process.cwd(), surface: 'claude-code', session_id: index[0] ? (index[0].id || index[0]) : null, targets: src.targets || [], planned_steps: carried, steps: [], decisions: cdec, forked_from: src.id, completed_at: null, outcome: null };
  wr(bcFile(nid), fk);
  src.forked_to = nid;
  src.forked_by = 'claude-code' + (fk.session_id ? ' ' + fk.session_id : '');
  src.forked_at = now;
  src.updated_at = now;
  wr(bcFile(src.id), src);
  wr(activeFile, { breadcrumb_id: nid, updated_at: now });
  ev('breadcrumb.fork', { id: nid, forked_from: src.id });
  console.log('forked ' + src.id + ' -> ' + nid + ': carried ' + carried.length + ' pending step(s) and ' + cdec.length + ' open decision(s). ' + src.id + ' is now frozen.');
} else if (MODE === 'retire') {
  if (!TEXT) { console.log('retire requires a recorded reason - an incomplete chain is never silently dropped'); process.exit(0); }
  let c = rd(bcFile(TARGET_ID));
  if (!c) { console.log('no breadcrumb ' + TARGET_ID); process.exit(0); }
  const fwd = {};
  while (c && c.forked_to && c.id && !fwd[c.id]) { fwd[c.id] = 1; const n = rd(bcFile(c.forked_to)); if (!n) break; c = n; }
  const seen = {}; const retired = [];
  while (c && c.id && !seen[c.id]) {
    seen[c.id] = 1;
    if (c.status !== 'complete' && c.status !== 'aborted') {
      c.status = 'aborted'; c.aborted_at = now; c.retired = true; c.retired_reason = TEXT; c.retired_by = 'claude-code';
      if (!c.outcome) c.outcome = 'retired: ' + TEXT;
      c.updated_at = now; wr(bcFile(c.id), c); retired.push(c.id);
    }
    if (openId === c.id) wr(activeFile, { breadcrumb_id: null, updated_at: now });
    c = c.forked_from ? rd(bcFile(c.forked_from)) : null;
  }
  ev('breadcrumb.chain_retire', { retired: retired, reason: TEXT });
  console.log(retired.length ? 'retired ' + retired.length + ' record(s): ' + retired.join(', ') : 'nothing left open on that chain');
} else if (MODE === 'backup') {
  if (!openBc) { console.log('no open breadcrumb'); process.exit(0); }
  const f = bcFile(openBc.id).replace(/\.json$/, '.bak-' + now.replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z') + '.json');
  wr(f, openBc);
  console.log('backed up to ' + f);
} else if (MODE === 'list') {
  let files = [];
  try { files = fs.readdirSync(DIR).filter(f => f.endsWith('.json') && f !== 'active.json' && !f.includes('.bak-')).map(f => ({ f, m: fs.statSync(path.join(DIR, f)).mtimeMs })).sort((a, b) => b.m - a.m).slice(0, 20); } catch (e) { }
  if (!files.length) { console.log('no breadcrumbs yet'); process.exit(0); }
  files.forEach(x => { const b = rd(path.join(DIR, x.f)) || {}; const st = b.status === 'complete' || b.status === 'aborted' ? b.status : (b.forked_to ? 'frozen -> ' + b.forked_to : (b.status || '?')); console.log([(b.id || x.f), '[' + st + ']', ((b.steps || []).length) + ' step(s)', (b.name || '')].join('  ')); });
} else {
  if (!openBc) { console.log('no open breadcrumb'); process.exit(0); }
  render(openBc);
}
```

## Discipline

- Log a step when a milestone is genuinely finished, not when you start it.
- New work that is still open when your output ends goes in with `add` - every time,
  no exceptions. Work fixed before the output ends needs no entry.
- Never work a blocked planned step. Resolve the decision first, and if it waits on
  the user, ask the user - do not decide for them.
- `complete` requires an outcome. `abort` requires a reason - an aborted arc with no
  reason is worse than no record.
- Before `complete`, check the files the breadcrumb targets actually contain the change.
  Steps are claims; the files are the evidence.
- If `start` reports one already open and it belongs to abandoned work, `abort` it with
  the reason rather than opening a second.
- If any command reports FROZEN, stop writing and read the chain head it names. That
  is not an error to route around; it is the record telling you the work moved.
