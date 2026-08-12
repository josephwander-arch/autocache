---
description: Show Autocache state health - open session, active breadcrumb, checkpoints, reminders, config, problems
allowed-tools: ["Bash", "Read", "Write", "Glob"]
---

# /status

What Autocache currently holds, and whether anything about it is broken. Read-only -
this command never writes state.

Arguments: `$ARGUMENTS`
- empty - the standard report
- `errors` - only the health section, with recent entries from `logs/events.jsonl`

Write the script to a temp file and run `node "<path>"` with the Bash tool.

```js
const fs = require('fs'), path = require('path'), os = require('os');
const BASE = process.env.AUTOCACHE_HOME || path.join(os.homedir(), '.autocache');
const SCOPE = (process.env.AUTOCACHE_SCOPE || 'claude-code').replace(/[^A-Za-z0-9._-]+/g, '_');
const HOME = path.join(BASE, 'stores', SCOPE); // scoped store (0.3.0+): commands run on the Claude surface
const ONLY_ERRORS = process.argv.includes('errors');
const problems = [];
const rd = (...p) => {
  const f = path.join(HOME, ...p);
  if (!fs.existsSync(f)) return null;
  try { return JSON.parse(fs.readFileSync(f, 'utf8')); }
  catch (e) { problems.push('unparseable JSON: ' + f + ' (' + e.message + ')'); return null; }
};
const count = d => { try { return fs.readdirSync(path.join(HOME, d)).filter(f => f.endsWith('.json') && f !== 'index.json' && f !== 'active.json' && !f.includes('.bak-')).length; } catch (e) { return 0; } };
const L = s => console.log(s);

L('AUTOCACHE STATUS');
L('  state root : ' + HOME + (process.env.AUTOCACHE_HOME ? '  (AUTOCACHE_HOME)' : ''));
if (!fs.existsSync(HOME)) { L('  NOT INITIALIZED - no state directory yet. It is created on the first session.'); process.exit(0); }

// writability
try { const t = path.join(HOME, '.write-probe.tmp'); fs.writeFileSync(t, 'x'); fs.unlinkSync(t); }
catch (e) { problems.push('state root is not writable: ' + e.message + ' - hooks will fail open and continuity will silently stop'); }

// leftover .tmp files mean an interrupted atomic write
try {
  const stale = [];
  const walk = d => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else if (e.name.endsWith('.tmp')) stale.push(p); } };
  walk(HOME);
  if (stale.length) problems.push(stale.length + ' leftover .tmp file(s) from an interrupted write: ' + stale.slice(0, 3).join(', '));
} catch (e) { }

const cfg = rd('config.json') || {};
const idxRaw = rd('sessions', 'index.json');
const index = Array.isArray(idxRaw) ? idxRaw : ((idxRaw && idxRaw.sessions) || []);
const sid = index[0] ? (index[0].id || index[0]) : null;
const sess = sid ? rd('sessions', sid + '.json') : null;
const act = rd('breadcrumbs', 'active.json');
const bid = act && (act.breadcrumb_id || act.id || null);
const bc = bid ? rd('breadcrumbs', bid + '.json') : null;
const remRaw = rd('reminders.json');
const rem = Array.isArray(remRaw) ? remRaw : ((remRaw && remRaw.reminders) || []);
const now = Date.now();
const due = rem.filter(r => r && r.status !== 'done' && r.status !== 'completed' && (!r.due_at || Date.parse(r.due_at) <= now));
const pending = rem.filter(r => r && r.status !== 'done' && r.status !== 'completed');

if (!ONLY_ERRORS) {
  L('');
  L('  tier       : free (Autocache)   version ' + (cfg.version || 'unknown'));
  L('  telemetry  : ' + (cfg.telemetry === true ? 'ON (opted in)' : 'off'));
  L('');
  L('  sessions   : ' + index.length + ' indexed, ' + count('sessions') + ' on disk');
  L('  current    : ' + (sess ? (sess.id + '  ' + (sess.title || '(untitled)') + '  [' + (sess.status || (sess.ended_at ? 'closed' : 'open')) + ']') : 'none'));
  const bcCount = count('breadcrumbs');
  L('  breadcrumbs: ' + bcCount + ' recorded');
  L('  active     : ' + (bc ? (bc.id + '  ' + (bc.name || bc.title || '') + '  ' + ((bc.steps || []).length) + ' step(s)') : 'none open'));
  L('  checkpoints: ' + count('checkpoints'));
  L('  reminders  : ' + pending.length + ' pending, ' + due.length + ' due now');
  const ss = rd('state', 'self_state.json');
  const bag = rd('state', 'bag.json');
  const tags = bag && (bag.tags || bag);
  L('  self-state : ' + (ss ? 'set (updated ' + (ss.updated_at || '?') + ')' : 'empty'));
  L('  bag        : ' + (tags ? Object.keys(tags).filter(k => k !== 'updated_at').length + ' tag(s)' : 'empty'));
  try { const s = fs.statSync(path.join(HOME, 'logs', 'events.jsonl')); L('  event log  : ' + (s.size / 1024).toFixed(1) + ' KB' + (s.size > 5 * 1024 * 1024 ? '  OVER 5 MB - due for rotation' : '')); } catch (e) { L('  event log  : none'); }

  if (due.length) { L(''); L('  DUE:'); due.forEach(r => L('    [' + (r.id || '?') + '] ' + (r.text || ''))); }

  // staleness signals
  if (bc && bc.status !== 'complete' && bc.status !== 'aborted') {
    const last = Date.parse(bc.updated_at || bc.created_at || 0);
    if (last && (now - last) > 86400000) problems.push('breadcrumb ' + bc.id + ' has been open for ' + Math.floor((now - last) / 86400000) + ' day(s) with no step - complete or abort it');
  }
  if (sess && !sess.ended_at && sess.started_at && (now - Date.parse(sess.started_at)) > 7 * 86400000) problems.push('session ' + sess.id + ' has been open for over a week - close it or it will keep being the one /resume restores');
}

L('');
L('  HEALTH');
if (!problems.length) L('    no problems detected');
else problems.forEach(p => L('    - ' + p));

if (ONLY_ERRORS) {
  L('');
  L('  RECENT EVENTS');
  try {
    const lines = fs.readFileSync(path.join(HOME, 'logs', 'events.jsonl'), 'utf8').trim().split('\n').slice(-25);
    lines.forEach(x => { try { const e = JSON.parse(x); L('    ' + e.at + '  ' + e.event + '  ' + JSON.stringify(e.data || {})); } catch (_) { L('    (unparseable log line)'); } });
  } catch (e) { L('    no event log'); }
}
```

## Reporting

Summarize in a few lines - do not re-print the whole dump. Lead with anything under
HEALTH, because those are the failures that make continuity silently stop working:

- **not writable** - hooks are failing open and nothing is being saved. Check permissions
  on the state root.
- **leftover .tmp** - a write was interrupted. The real file is intact by design; the
  stray `.tmp` is safe to delete.
- **unparseable JSON** - name the file. Suggest moving it aside rather than editing it
  blind; the next session will recreate it.
- **stale open breadcrumb** - offer `/breadcrumb complete` or `/breadcrumb abort`.

If everything is clean, say so in one line and stop. Do not pad the report.
