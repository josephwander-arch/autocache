---
description: Export a session, breadcrumb, or checkpoint as markdown or JSON you can read, paste, or archive
allowed-tools: ["Bash", "Read", "Write", "Glob"]
---

# /export

Turn Autocache state into a document. Useful for a PR description, a bug report, a
standup note, or just proving to yourself what the state actually holds - it is plain
JSON on your disk and this makes it readable.

Arguments: `$ARGUMENTS`
- empty - the newest session, as markdown, to the terminal
- `session [id]` / `breadcrumb [id]` / `checkpoint [id]` - pick the record
- `json` - raw JSON instead of markdown
- `all` - export every session as one markdown document
- a path ending in `.md` or `.json` - write there instead of printing
- `open` - print the paths of every state file so the user can inspect them directly

Set `KIND`, `ID`, `FORMAT`, `OUT`, write to a temp file, run `node "<path>"`.

```js
const fs = require('fs'), path = require('path'), os = require('os');

const KIND = "session";     // session | breadcrumb | checkpoint | all | open
const ID = null;            // specific id, or null for newest
const FORMAT = "md";        // md | json
const OUT = null;           // absolute output path, or null to print

const HOME = process.env.AUTOCACHE_HOME || path.join(os.homedir(), '.autocache');
const rd = f => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { return null; } };
const dirOf = k => path.join(HOME, k === 'session' ? 'sessions' : k === 'breadcrumb' ? 'breadcrumbs' : 'checkpoints');
const newestIn = d => { try { return fs.readdirSync(d).filter(f => f.endsWith('.json') && f !== 'index.json' && f !== 'active.json' && !f.includes('.bak-')).map(f => ({ f, m: fs.statSync(path.join(d, f)).mtimeMs })).sort((a, b) => b.m - a.m); } catch (e) { return []; } };

if (KIND === 'open') {
  const walk = d => { let out = []; try { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); out = out.concat(e.isDirectory() ? walk(p) : [p]); } } catch (x) { } return out; };
  const files = walk(HOME);
  if (!files.length) console.log('no state files under ' + HOME);
  else files.forEach(f => { let sz = 0; try { sz = fs.statSync(f).size; } catch (e) { } console.log(String(sz).padStart(8) + '  ' + f); });
  process.exit(0);
}

const L = [];
const sec = (h, v) => { const a = Array.isArray(v) ? v : (v ? [v] : []); if (a.length) { L.push(''); L.push('## ' + h); a.forEach(x => L.push('- ' + (typeof x === 'string' ? x : (x.text || JSON.stringify(x))))); } };

const renderSession = s => {
  L.push('# Session: ' + (s.title || s.id));
  L.push('');
  L.push('- id: `' + s.id + '`');
  L.push('- started: ' + (s.started_at || '?') + (s.ended_at ? '  ended: ' + s.ended_at : '  (still open)'));
  if (s.cwd) L.push('- cwd: `' + s.cwd + '`');
  if (s.surface) L.push('- surface: ' + s.surface);
  const sum = s.summary || {};
  if (typeof sum === 'string') { L.push(''); L.push(sum); }
  else { sec('Done', sum.done); sec('Remaining', sum.remaining); sec('Risks', sum.risks); if (sum.next_action) { L.push(''); L.push('## Next action'); L.push(sum.next_action); } }
  sec('Findings', s.findings);
  if (s.handoff) {
    L.push('');
    L.push('## Handoff');
    L.push('Written ' + (s.handoff.written_at || '?') + (s.handoff.to ? ' to ' + s.handoff.to : ''));
    ['done', 'remaining', 'risks', 'context', 'open_questions'].forEach(k => sec('Handoff / ' + k, s.handoff[k]));
    if (s.handoff.next_action) { L.push(''); L.push('Next action: ' + s.handoff.next_action); }
  }
};
const renderBreadcrumb = b => {
  L.push('# Breadcrumb: ' + (b.name || b.id));
  L.push('');
  L.push('- id: `' + b.id + '`  status: ' + (b.status || '?'));
  L.push('- started: ' + (b.created_at || '?') + (b.completed_at ? '  ended: ' + b.completed_at : ''));
  if (b.targets && b.targets.length) L.push('- targets: ' + b.targets.map(t => '`' + t + '`').join(', '));
  if ((b.steps || []).length) { L.push(''); L.push('## Steps'); b.steps.forEach((s, i) => L.push((i + 1) + '. ' + (s.text || JSON.stringify(s)) + '  _' + (s.at || '') + '_')); }
  sec('Still planned', (b.planned_steps || []).filter(p => !(b.steps || []).some(s => String(s.text || '').toLowerCase().includes(String(p).toLowerCase().slice(0, 24)))));
  if (b.outcome) { L.push(''); L.push('## Outcome'); L.push(b.outcome); }
};
const renderCheckpoint = c => {
  L.push('# Checkpoint: ' + (c.label || c.id));
  L.push('');
  L.push('- id: `' + c.id + '`  saved: ' + (c.created_at || '?'));
  if (c.git && (c.git.branch || c.git.head)) L.push('- git: ' + [c.git.branch, c.git.head, c.git.dirty ? 'DIRTY' : 'clean'].filter(Boolean).join(' @ '));
  if (c.summary) { L.push(''); L.push(c.summary); }
  sec('Done', c.done); sec('Remaining', c.remaining); sec('Risks', c.risks); sec('Files touched', c.files_touched);
  if (c.next_action) { L.push(''); L.push('## Next action'); L.push(c.next_action); }
};

let payload = null;
if (KIND === 'all') {
  const d = dirOf('session');
  const files = newestIn(d);
  payload = files.map(x => rd(path.join(d, x.f))).filter(Boolean);
  L.push('# Autocache sessions (' + payload.length + ')');
  payload.forEach(s => { L.push(''); L.push('---'); L.push(''); renderSession(s); });
} else {
  const d = dirOf(KIND);
  let file = null;
  if (ID) { const hit = newestIn(d).find(x => x.f.indexOf(ID) === 0 || x.f.includes(ID)); file = hit ? path.join(d, hit.f) : null; }
  else if (KIND === 'session') { const idxRaw = rd(path.join(d, 'index.json')); const index = Array.isArray(idxRaw) ? idxRaw : ((idxRaw && idxRaw.sessions) || []); const sid = index[0] ? (index[0].id || index[0]) : null; file = sid ? path.join(d, sid + '.json') : (newestIn(d)[0] ? path.join(d, newestIn(d)[0].f) : null); }
  else { const n = newestIn(d)[0]; file = n ? path.join(d, n.f) : null; }
  if (!file || !fs.existsSync(file)) { console.log('no ' + KIND + ' found' + (ID ? ' matching ' + ID : '') + ' in ' + d); process.exit(0); }
  payload = rd(file);
  if (!payload) { console.log('could not parse ' + file); process.exit(0); }
  (KIND === 'session' ? renderSession : KIND === 'breadcrumb' ? renderBreadcrumb : renderCheckpoint)(payload);
}

const text = FORMAT === 'json' ? JSON.stringify(payload, null, 2) : L.join('\n') + '\n';
if (OUT) {
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  const t = OUT + '.tmp';
  fs.writeFileSync(t, text);
  fs.renameSync(t, OUT);
  console.log('wrote ' + OUT + '  (' + text.length + ' bytes)');
} else { console.log(text); }
```

## Reporting

- Printing to the terminal: pass the markdown through as-is. Do not re-summarize it -
  the point of an export is that it is the record, not your reading of it.
- Writing to a file: confirm the path and the size, then say in one line what is in it.
- If the user asked for something to paste elsewhere (PR body, standup note), export
  first and then offer a trimmed version - keep the full export intact either way.

Everything exported is already on the user's disk in plain JSON. Nothing is uploaded.
