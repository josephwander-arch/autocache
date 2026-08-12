---
description: Reconstruct what you were doing - last session, open breadcrumb, checkpoint, due reminders, self-state
allowed-tools: ["Bash", "Read", "Write", "Glob"]
---

# /resume

Rebuild the working context of the previous session from the scoped store (`~/.autocache/stores/<surface>/`) and state it
plainly, then propose the single next concrete action.

Arguments (optional): `$ARGUMENTS`
- empty - resume the newest session
- a session id (`sess-...`) - resume that session instead
- `full` - also print every finding and every breadcrumb step, not just the tail

## How to run it

State base is `AUTOCACHE_HOME` if set, otherwise `<home>/.autocache`; state lives in the scoped store `stores/<surface>/` beneath it (0.3.0+).

Do not read the state files one at a time. Write the script below to a temporary file
in the system temp directory (for example `autocache-resume.js`), then run it with the
Bash tool as `node "<that path>"`. One process, one digest, no path-separator problems
on Windows.

```js
const fs = require('fs'), path = require('path'), os = require('os');
const BASE = process.env.AUTOCACHE_HOME || path.join(os.homedir(), '.autocache');
const SCOPE = (process.env.AUTOCACHE_SCOPE || 'claude-code').replace(/[^A-Za-z0-9._-]+/g, '_');
const HOME = path.join(BASE, 'stores', SCOPE); // scoped store (0.3.0+): commands run on the Claude surface
const FULL = process.argv.includes('full');
const WANT = (process.argv.find(a => a.startsWith('sess-')) || '').trim();
const rd = (...p) => { try { return JSON.parse(fs.readFileSync(path.join(HOME, ...p), 'utf8')); } catch (e) { return null; } };
const arr = v => Array.isArray(v) ? v : (v && Array.isArray(v.items) ? v.items : []);
const tail = (a, n) => FULL ? a : a.slice(-n);
const line = s => console.log(s);

if (!fs.existsSync(HOME)) { line('AUTOCACHE: no state at ' + HOME + ' - nothing to resume yet.'); process.exit(0); }
line('AUTOCACHE RESUME  (state: ' + HOME + ')');

// ---- session -------------------------------------------------------------
const idxRaw = rd('sessions', 'index.json');
const index = Array.isArray(idxRaw) ? idxRaw : arr(idxRaw && idxRaw.sessions ? { items: idxRaw.sessions } : null);
const pick = WANT ? index.find(s => (s.id || s) === WANT) : index[0];
const sid = pick ? (pick.id || pick) : null;
const sess = sid ? rd('sessions', sid + '.json') : null;
line('');
line('== LAST SESSION ==');
if (!sess) { line('  none recorded' + (WANT ? ' for ' + WANT : '')); }
else {
  line('  id      : ' + (sess.id || sid));
  line('  title   : ' + (sess.title || '(untitled)'));
  line('  when    : ' + (sess.started_at || '?') + ' -> ' + (sess.ended_at || 'still open'));
  if (sess.cwd) line('  cwd     : ' + sess.cwd);
  const sum = sess.summary || {};
  const blk = (label, v) => { const a = Array.isArray(v) ? v : (v ? [v] : []); if (a.length) { line('  ' + label + ':'); a.forEach(x => line('    - ' + (typeof x === 'string' ? x : JSON.stringify(x)))); } };
  if (typeof sum === 'string') line('  summary : ' + sum);
  else { blk('done', sum.done); blk('remaining', sum.remaining); blk('risks', sum.risks); if (sum.next_action) line('  next    : ' + sum.next_action); }
  const f = arr(sess.findings || { items: sess.findings });
  if (f.length) { line('  findings (' + f.length + (FULL ? '' : ', last 5') + '):'); tail(f, 5).forEach(x => line('    - ' + (x.text || JSON.stringify(x)))); }
}

// ---- breadcrumb ----------------------------------------------------------
line('');
line('== OPEN BREADCRUMB ==');
const act = rd('breadcrumbs', 'active.json');
const bid = act && (act.breadcrumb_id || act.id || null);
let bc = bid ? (rd('breadcrumbs', bid + '.json') || (act.steps ? act : null)) : null;
if (bc && bc.forked_to) {
  // The pointer names a frozen record: the work moved. Follow the chain to
  // its head and report every hop - never write to a frozen record.
  line('  pointer ' + (bc.id || bid) + ' is FROZEN - following the fork chain:');
  const seen = {}; let hops = 0;
  while (bc && bc.forked_to && !seen[bc.id] && hops < 50) {
    seen[bc.id] = 1; hops += 1;
    line('    ' + bc.id + ' -> forked to ' + bc.forked_to + (bc.forked_by ? ' by ' + bc.forked_by : '') + (bc.forked_at ? ' at ' + bc.forked_at : ''));
    const nx = rd('breadcrumbs', bc.forked_to + '.json');
    if (!nx) { line('    ' + bc.forked_to + ' (record missing)'); bc = null; break; }
    bc = nx;
  }
  if (bc) line('  chain head: ' + bc.id + ' [' + (bc.status || 'open') + ']');
}
if (!bc) { line('  none open'); }
else {
  line('  id      : ' + (bc.id || bid));
  line('  name    : ' + (bc.name || bc.title || '(unnamed)'));
  line('  status  : ' + (bc.status || 'open') + '   started ' + (bc.created_at || bc.started_at || '?'));
  if (bc.completed_via) line('  finished elsewhere - completed via ' + bc.completed_via);
  if (bc.retired) line('  retired : ' + (bc.retired_reason || '(no reason recorded)'));
  const t = arr(bc.targets ? { items: bc.targets } : null);
  if (t.length) line('  targets : ' + t.join(', '));
  const planned = arr(bc.planned_steps ? { items: bc.planned_steps } : null);
  const steps = arr(bc.steps ? { items: bc.steps } : null);
  if (steps.length) { line('  done so far (' + steps.length + (FULL ? '' : ', last 6') + '):'); tail(steps, 6).forEach((s, i) => line('    ' + (i + 1) + '. ' + (s.text || s.note || JSON.stringify(s)))); }
  else line('  no steps logged yet');
  const openDecs = (bc.decisions || []).filter(d => d && d.status !== 'resolved' && !d.chosen);
  const blocked = {};
  openDecs.forEach(d => (d.blocks || []).forEach(i => { blocked[i] = d; }));
  if (planned.length) {
    const doneTexts = steps.map(s => String(s.text || '').toLowerCase());
    const open = [];
    planned.forEach((p, i) => { if (!doneTexts.some(d => d.includes(String(p).toLowerCase().slice(0, 24)))) open.push({ i: i, p: p }); });
    if (open.length) { line('  still planned:'); open.forEach(x => line('    ' + x.i + '. ' + x.p + (blocked[x.i] ? '   [BLOCKED by ' + blocked[x.i].id + ']' : ''))); }
  }
  if (openDecs.length) {
    line('  awaiting decision:');
    openDecs.forEach(d => line('    ' + d.id + ': ' + d.question + ' | options: ' + (d.options || []).join(' / ') + (d.lean ? ' | lean: ' + d.lean : '') + ' | waits on ' + (d.waits_on || 'user')));
  }
}

// ---- checkpoint ----------------------------------------------------------
line('');
line('== LATEST CHECKPOINT ==');
let ck = null;
try {
  const dir = path.join(HOME, 'checkpoints');
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.json'));
  const newest = files.map(f => ({ f, m: fs.statSync(path.join(dir, f)).mtimeMs })).sort((a, b) => b.m - a.m)[0];
  if (newest) ck = rd('checkpoints', newest.f);
} catch (e) { }
if (!ck) line('  none saved');
else {
  line('  id      : ' + (ck.id || '?') + '   ' + (ck.created_at || ''));
  if (ck.label) line('  label   : ' + ck.label);
  if (ck.git && (ck.git.branch || ck.git.head)) line('  git     : ' + [ck.git.branch, ck.git.head, ck.git.dirty ? 'DIRTY working tree' : 'clean'].filter(Boolean).join(' @ '));
  if (ck.summary) line('  summary : ' + ck.summary);
  ['done', 'remaining', 'risks'].forEach(k => { const a = arr(ck[k] ? { items: ck[k] } : null); if (a.length) { line('  ' + k + ':'); a.forEach(x => line('    - ' + x)); } });
  if (ck.next_action) line('  next    : ' + ck.next_action);
}

// ---- reminders -----------------------------------------------------------
line('');
line('== REMINDERS DUE ==');
const rem = rd('reminders.json');
const rl = Array.isArray(rem) ? rem : arr(rem && rem.reminders ? { items: rem.reminders } : null);
const now = Date.now();
const due = rl.filter(r => r && r.status !== 'done' && r.status !== 'completed' && (!r.due_at || Date.parse(r.due_at) <= now));
const later = rl.filter(r => r && r.status !== 'done' && r.status !== 'completed' && r.due_at && Date.parse(r.due_at) > now);
if (!due.length) line('  none due' + (later.length ? ' (' + later.length + ' scheduled later)' : ''));
else due.forEach(r => line('  [' + (r.id || '?') + '] ' + (r.text || '') + (r.due_at ? '  (due ' + r.due_at + ')' : '')));

// ---- self-state and bag --------------------------------------------------
line('');
line('== SELF-STATE ==');
const ss = rd('state', 'self_state.json');
if (!ss) line('  none');
else {
  Object.keys(ss).filter(k => k !== 'notes' && k !== 'updated_at').forEach(k => line('  ' + k + ' : ' + (typeof ss[k] === 'string' ? ss[k] : JSON.stringify(ss[k]))));
  const n = arr(ss.notes ? { items: ss.notes } : null);
  if (n.length) { line('  notes (' + (FULL ? 'all' : 'last 5') + '):'); tail(n, 5).forEach(x => line('    - ' + (x.text || x))); }
}
const bag = rd('state', 'bag.json');
const tags = bag && (bag.tags || bag);
if (tags && typeof tags === 'object') {
  const keys = Object.keys(tags).filter(k => k !== 'updated_at');
  if (keys.length) { line(''); line('== BAG =='); keys.forEach(k => { const v = tags[k]; line('  ' + k + ' = ' + (v && typeof v === 'object' && 'value' in v ? JSON.stringify(v.value) : JSON.stringify(v))); }); }
}
line('');
line('END');
```

Run it with `full` and/or a session id appended when the arguments call for it:
`node "<path>" full` or `node "<path>" sess-...`.

## What to do with the output

1. If the script printed `no state` or every section is empty, say so in one line and
   stop. Do not invent a prior session.
2. Otherwise write a short reconstruction in this shape - prose, not a data dump:

   **Where you left off** - one or two sentences naming the actual work.
   **Completed** - the breadcrumb steps and session `done` items, condensed.
   **Open** - remaining items, unfinished planned steps, and a DIRTY working tree if
   the checkpoint reported one.
   **Watch out for** - risks from the checkpoint or session summary; say "none recorded"
   rather than inventing any.
   **Reminders** - only the ones actually due.

3. End with exactly one **next concrete action** - a specific file, command, or step,
   drawn from `next_action` if present, otherwise from the first unfinished planned step.
   Then ask whether to proceed with it.
4. Read the files named in the breadcrumb targets or the checkpoint before acting on
   them. The state describes the work; it is not a substitute for the current code.
5. Do not claim anything the state does not say. If the previous session ended without
   a summary, report that the session ended without one.
6. If the script reported a **fork chain**, act on the head's status, never on the
   frozen pointer:
   - head **open** - the work is live elsewhere. Catch up by reading the chain, then
     work read-only, ask for a pass, or take over by forking the head. Apply the
     takeover eligibility ladder in the `autocache-handoff` skill before forking, and
     never write to a frozen record - every write is rejected naming the head.
   - head **complete** (or the pointer carries `completed_via`) - the work was
     finished elsewhere. Report the pointer in one line and stop; there is nothing to
     resume.
   - head **aborted** and not retired - the chain tail is adoptable work. Offer
     `/breadcrumb adopt <tail-id>` to continue it or `/breadcrumb retire <tail-id>
     <reason>` to close the chain out. Never just drop it: an incomplete chain keeps
     surfacing until it is completed through the chain or retired with a reason.
7. A step marked BLOCKED waits on its decision. If it `waits_on: "user"`, put the
   question, the options, and any recorded lean in front of the user; do not answer
   it yourself. Unblocked steps are fair game meanwhile.
