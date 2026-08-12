---
description: Save, load, list, or clear a checkpoint of the current work arc
allowed-tools: ["Bash", "Read", "Write", "Glob"]
---

# /checkpoint

A checkpoint is a snapshot of the arc you are in the middle of: what is done, what is
left, what is risky, the one next action, and the git position it all refers to.
`/resume` and the `Stop` hook both read it.

Arguments: `$ARGUMENTS`
- empty or a free-text label - **save** a checkpoint with that label
- `load` or `load <id>` - print the newest checkpoint, or the named one
- `list` - list saved checkpoints newest first
- `clear` - delete all checkpoints (confirm with the user first)

State base is `AUTOCACHE_HOME` if set, otherwise `<home>/.autocache`; state lives in the scoped store `stores/<surface>/` beneath it (0.3.0+). For every mode,
write the script to a temp file and run `node "<path>"` with the Bash tool.

## Save

Compose the packet yourself from the current conversation before writing anything.
Be specific: file paths, command names, error text. "Continue the work" is a useless
checkpoint. Leave an array empty rather than padding it.

Fill the `PACKET` literal, then run:

```js
const fs = require('fs'), path = require('path'), os = require('os'), cp = require('child_process');

const PACKET = {
  label: "<short label, or the user's argument>",
  summary: "<one sentence: what this arc is>",
  done: ["<completed, specific>"],
  remaining: ["<not yet done, specific>"],
  risks: ["<what could bite the next session>"],
  next_action: "<the single next concrete step>",
  files_touched: ["<absolute paths>"]
};

const BASE = process.env.AUTOCACHE_HOME || path.join(os.homedir(), '.autocache');
const SCOPE = (process.env.AUTOCACHE_SCOPE || 'claude-code').replace(/[^A-Za-z0-9._-]+/g, '_');
const HOME = path.join(BASE, 'stores', SCOPE); // scoped store (0.3.0+): commands run on the Claude surface
const now = new Date().toISOString();
const id = 'ckpt-' + now.replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z') + '-' + require('crypto').randomBytes(3).toString('hex');
const rd = (...p) => { try { return JSON.parse(fs.readFileSync(path.join(HOME, ...p), 'utf8')); } catch (e) { return null; } };
const wr = (rel, obj) => { const f = path.join(HOME, ...rel); fs.mkdirSync(path.dirname(f), { recursive: true }); const t = f + '.tmp'; fs.writeFileSync(t, JSON.stringify(obj, null, 2)); fs.renameSync(t, f); return f; };
const git = c => { try { return cp.execSync('git ' + c, { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); } catch (e) { return null; } };

const act = rd('breadcrumbs', 'active.json');
const idx = rd('sessions', 'index.json');
const sessions = Array.isArray(idx) ? idx : ((idx && idx.sessions) || []);

const ck = Object.assign({
  id: id,
  created_at: now,
  cwd: process.cwd(),
  surface: 'claude-code',
  session_id: sessions[0] ? (sessions[0].id || sessions[0]) : null,
  breadcrumb_id: act ? (act.breadcrumb_id || act.id || null) : null,
  git: { branch: git('rev-parse --abbrev-ref HEAD'), head: git('rev-parse --short HEAD'), dirty: !!git('status --porcelain') }
}, PACKET);

const f = wr(['checkpoints', id + '.json'], ck);
try {
  const log = path.join(HOME, 'logs', 'events.jsonl');
  fs.mkdirSync(path.dirname(log), { recursive: true });
  fs.appendFileSync(log, JSON.stringify({ at: now, event: 'checkpoint.save', surface: 'claude-code', data: { id: id, label: ck.label } }) + '\n');
} catch (e) { }
console.log('saved ' + f);
console.log('git: ' + ((ck.git.branch || ck.git.head) ? [ck.git.branch, ck.git.head, ck.git.dirty ? 'DIRTY' : 'clean'].filter(Boolean).join(' @ ') : 'not a git repo'));
```

Then confirm in one line: the id, the label, and the next action you recorded.

## Load / list

```js
const fs = require('fs'), path = require('path'), os = require('os');
const BASE = process.env.AUTOCACHE_HOME || path.join(os.homedir(), '.autocache');
const SCOPE = (process.env.AUTOCACHE_SCOPE || 'claude-code').replace(/[^A-Za-z0-9._-]+/g, '_');
const HOME = path.join(BASE, 'stores', SCOPE); // scoped store (0.3.0+): commands run on the Claude surface
const dir = path.join(HOME, 'checkpoints');
const MODE = process.argv[2] || 'load';      // load | list
const WANT = process.argv[3] || null;
let files = [];
try { files = fs.readdirSync(dir).filter(f => f.endsWith('.json')).map(f => ({ f, m: fs.statSync(path.join(dir, f)).mtimeMs })).sort((a, b) => b.m - a.m); } catch (e) { }
if (!files.length) { console.log('no checkpoints in ' + dir); process.exit(0); }
const rd = f => { try { return JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')); } catch (e) { return null; } };
if (MODE === 'list') {
  files.forEach(x => { const c = rd(x.f) || {}; console.log([c.id || x.f, c.created_at || '', c.label || '', c.next_action ? '-> ' + c.next_action : ''].join('  ')); });
} else {
  const target = WANT ? (files.find(x => x.f.indexOf(WANT) === 0) || files.find(x => x.f.includes(WANT))) : files[0];
  if (!target) { console.log('no checkpoint matching ' + WANT); process.exit(0); }
  console.log(JSON.stringify(rd(target.f), null, 2));
}
```

On load, do not just echo the JSON at the user. Restate it as: where the arc stands,
what is left, the git position, and the next action - then read the files it names
before continuing, because the checkpoint may be older than the working tree.

## Clear

Deleting checkpoints is irreversible. Ask the user to confirm, then:

```js
const fs = require('fs'), path = require('path'), os = require('os');
const BASE = process.env.AUTOCACHE_HOME || path.join(os.homedir(), '.autocache');
const SCOPE = (process.env.AUTOCACHE_SCOPE || 'claude-code').replace(/[^A-Za-z0-9._-]+/g, '_');
const HOME = path.join(BASE, 'stores', SCOPE); // scoped store (0.3.0+): commands run on the Claude surface
const dir = path.join(HOME, 'checkpoints');
let n = 0;
try { fs.readdirSync(dir).filter(f => f.endsWith('.json')).forEach(f => { fs.unlinkSync(path.join(dir, f)); n++; }); } catch (e) { }
console.log('removed ' + n + ' checkpoint(s)');
```

Checkpoints are local plain JSON. Nothing leaves the machine.
