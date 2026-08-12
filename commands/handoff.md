---
description: Write a continuation packet another agent or session can execute without this transcript
allowed-tools: ["Bash", "Read", "Write", "Glob", "Grep", "Task"]
---

# /handoff

A handoff is not a transcript and not a summary. It is a packet the *next* agent can
execute cold: what is done, what remains, what is dangerous, and the exact next action.
It gets written into the session record so `/resume` and the `SessionStart` hook pick
it up, and optionally to a markdown file you can paste anywhere.

Arguments: `$ARGUMENTS`
- empty - hand off the current/newest session
- a path ending in `.md` - also write the packet to that file
- `to <name>` - address the packet to another agent or surface (recorded, not sent)

## 1. Gather, do not guess

If this conversation is long, or you are unsure you can recall the whole arc, delegate
first: launch the `session-summarizer` subagent with the session id and the state root.
It returns the packet fields without pulling the transcript into this context. Use its
output as the draft.

Otherwise read the current state directly - active breadcrumb, newest checkpoint, open
session - with the `/resume` digest script, then draft from that plus what you did in
this conversation.

## 2. Draft the packet

Five fields, all required, all specific:

- **done** - what is actually finished and verified. A file written is not a feature
  working; say which it is.
- **remaining** - what is left, in the order it should be done.
- **risks** - what would bite someone who did not watch it happen. Uncommitted changes,
  a staged binary awaiting restart, a test that passes for the wrong reason, a
  half-migrated config.
- **next_action** - one step. A command, a file, an edit. Not "continue".
- **context** - the two or three facts that are not obvious from the code: why an
  approach was rejected, what the user ruled on, what the failing symptom actually was.

Also list `files_touched` (absolute paths) and `open_questions` (things only the user
can decide).

## 3. Write it

Fill `PACKET`, then run `node "<temp file>"`:

```js
const fs = require('fs'), path = require('path'), os = require('os'), cp = require('child_process');

const PACKET = {
  to: null,                                  // "codex" | "next-session" | null
  title: "<the arc in a few words>",
  done: [],
  remaining: [],
  risks: [],
  next_action: "",
  context: [],
  files_touched: [],
  open_questions: []
};
const MD_OUT = null;                         // absolute path, or null

const BASE = process.env.AUTOCACHE_HOME || path.join(os.homedir(), '.autocache');
const SCOPE = (process.env.AUTOCACHE_SCOPE || 'claude-code').replace(/[^A-Za-z0-9._-]+/g, '_');
const HOME = path.join(BASE, 'stores', SCOPE); // scoped store (0.3.0+): commands run on the Claude surface
const now = new Date().toISOString();
const rd = (...p) => { try { return JSON.parse(fs.readFileSync(path.join(HOME, ...p), 'utf8')); } catch (e) { return null; } };
const wr = (rel, obj) => { const f = path.join(HOME, ...rel); fs.mkdirSync(path.dirname(f), { recursive: true }); const t = f + '.tmp'; fs.writeFileSync(t, JSON.stringify(obj, null, 2)); fs.renameSync(t, f); return f; };
const git = c => { try { return cp.execSync('git ' + c, { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); } catch (e) { return null; } };

const idxRaw = rd('sessions', 'index.json');
const index = Array.isArray(idxRaw) ? idxRaw : ((idxRaw && idxRaw.sessions) || []);
const sid = index[0] ? (index[0].id || index[0]) : null;
const act = rd('breadcrumbs', 'active.json');

const handoff = Object.assign({}, PACKET, {
  written_at: now,
  from: 'claude-code',
  session_id: sid,
  breadcrumb_id: act ? (act.breadcrumb_id || act.id || null) : null,
  cwd: process.cwd(),
  git: { branch: git('rev-parse --abbrev-ref HEAD'), head: git('rev-parse --short HEAD'), dirty: !!git('status --porcelain') }
});

if (sid) {
  const s = rd('sessions', sid + '.json');
  if (s) {
    s.handoff = handoff;
    s.summary = Object.assign({}, s.summary, { done: handoff.done, remaining: handoff.remaining, risks: handoff.risks, next_action: handoff.next_action });
    s.updated_at = now;
    console.log('updated ' + wr(['sessions', sid + '.json'], s));
  }
} else { console.log('no session record found - packet written to markdown only'); }

if (MD_OUT) {
  const L = [];
  L.push('# Handoff: ' + (handoff.title || 'untitled'));
  L.push('');
  L.push('Written ' + now + ' from ' + handoff.from + (handoff.to ? ' to ' + handoff.to : '') + '.');
  L.push('Repo: ' + handoff.cwd + '  branch ' + (handoff.git.branch || '?') + ' @ ' + (handoff.git.head || '?') + (handoff.git.dirty ? ' (DIRTY working tree)' : ''));
  const sec = (h, a) => { if (a && a.length) { L.push(''); L.push('## ' + h); a.forEach(x => L.push('- ' + x)); } };
  sec('Done', handoff.done);
  sec('Remaining', handoff.remaining);
  sec('Risks', handoff.risks);
  sec('Context', handoff.context);
  sec('Files touched', handoff.files_touched);
  sec('Open questions', handoff.open_questions);
  L.push('');
  L.push('## Next action');
  L.push(handoff.next_action || '(none recorded)');
  L.push('');
  fs.mkdirSync(path.dirname(MD_OUT), { recursive: true });
  const t = MD_OUT + '.tmp';
  fs.writeFileSync(t, L.join('\n'));
  fs.renameSync(t, MD_OUT);
  console.log('wrote ' + MD_OUT);
}

try {
  const log = path.join(HOME, 'logs', 'events.jsonl');
  fs.mkdirSync(path.dirname(log), { recursive: true });
  fs.appendFileSync(log, JSON.stringify({ at: now, event: 'handoff.write', surface: 'claude-code', data: { session_id: sid, to: handoff.to } }) + '\n');
} catch (e) { }
```

## 4. Report

Print the packet to the user in the same five sections. Then state the one thing that
would make the next session fail if they missed it - usually the dirty working tree or
an unverified assumption. If the git position came back dirty, say so explicitly; do
not commit anything unless the user asks.

State stays on this machine. A handoff does not send anything anywhere - the other
agent reads the same scoped store, adopts it via the shared-tag bridge and fork chain, or you paste the markdown.

## Handing off an open breadcrumb: packet plus fork

The packet carries the knowledge; the fork chain carries the ownership. They are
complementary, not alternatives.

- **Announced handoff** (you are passing the work): write the packet, leave the
  breadcrumb open, and say in the packet that the receiver should fork it on arrival.
  The receiver runs `/breadcrumb fork <id>` - the new record carries the remaining
  steps and open decisions, the old one freezes, and every later write against it is
  rejected with a message naming the new head. That rejection is the mechanism that
  stops two sessions from working the same operation.
- **Take-back** (the work comes home): fork the current head. Never re-open a frozen
  ancestor - the chain grows forward and every hop stays attributed through
  `forked_by` and `forked_at`.
- **Takeover without a pass** (the holder went quiet): apply the eligibility ladder
  in the `autocache-handoff` skill before forking. Forking a live session's head can
  corrupt the operation; the ladder exists so that only demonstrably idle work gets
  taken.
- Whoever completes the final head closes the whole chain: every still-open ancestor
  is marked `completed_via` the head, so the session that originally held the work
  resumes into a pointer, not a dangling operation.
