---
description: Local reminders - add, list, complete, delete, check what is due, set recurring
allowed-tools: ["Bash", "Read", "Write"]
---

# /remind

Reminders live in `~/.autocache/reminders.json` and surface at the start of the next
session and in `/resume`. They are local and passive - nothing fires a notification,
nothing leaves the machine. A reminder is a note your future session will actually see.

Arguments: `$ARGUMENTS`
- free text, optionally with a time - **add**. "in 2 hours", "tomorrow 9am", "monday",
  "every friday" are all fine; you resolve them, not a parser.
- `list` - pending reminders, soonest first
- `due` - only what is due now
- `done <id>` / `complete <id>` - mark complete (a recurring one rolls to its next due)
- `delete <id>` - remove it
- `all` - include completed ones in the listing

## Resolving time yourself

Before writing, get the real current time - run `node -e "console.log(new Date().toISOString())"`
rather than assuming what "now" is. Then convert the user's phrasing into an absolute
ISO-8601 UTC timestamp for `due_at`, and set `recurring` only when the phrasing is
genuinely repeating:

- "in 2 hours" -> now + 2h
- "tomorrow 9am" -> next 09:00 local, converted to UTC
- "every friday" -> next Friday, `recurring: { every: "7d" }`
- "every morning" -> next 09:00, `recurring: { every: "1d" }`
- no time at all -> `due_at: null`, meaning it shows up at the very next session

State the resolved time back to the user in their local terms so a bad parse is visible.

## Run

One script covers every mode. Set `MODE`, `TEXT`, `DUE_AT`, `RECURRING`, `TARGET`, then
write it to a temp file and run `node "<path>"`.

```js
const fs = require('fs'), path = require('path'), os = require('os'), crypto = require('crypto');

const MODE = "add";              // add | list | due | done | delete
const TEXT = "";                 // add: the reminder text
const DUE_AT = null;             // add: ISO-8601 UTC string, or null
const RECURRING = null;          // add: { every: "1d" } | { every: "7d" } | null
const TAGS = [];                 // add: optional labels
const TARGET = "";               // done | delete: the reminder id
const SHOW_ALL = false;          // list: include completed

const HOME = process.env.AUTOCACHE_HOME || path.join(os.homedir(), '.autocache');
const FILE = path.join(HOME, 'reminders.json');
const now = new Date();
const nowIso = now.toISOString();

let doc = { reminders: [], updated_at: nowIso };
try { const raw = JSON.parse(fs.readFileSync(FILE, 'utf8')); doc = Array.isArray(raw) ? { reminders: raw, updated_at: nowIso } : raw; } catch (e) { }
if (!Array.isArray(doc.reminders)) doc.reminders = [];

const save = () => {
  doc.updated_at = nowIso;
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  const t = FILE + '.tmp';
  fs.writeFileSync(t, JSON.stringify(doc, null, 2));
  fs.renameSync(t, FILE);
};
const isOpen = r => r && r.status !== 'done' && r.status !== 'completed';
const bump = (iso, every) => {
  const m = /^(\d+)([smhdw])$/.exec(String(every || ''));
  if (!m) return null;
  const mult = { s: 1e3, m: 6e4, h: 36e5, d: 864e5, w: 6048e5 }[m[2]];
  let next = Date.parse(iso || nowIso) + Number(m[1]) * mult;
  while (next <= now.getTime()) next += Number(m[1]) * mult;   // never schedule into the past
  return new Date(next).toISOString();
};
const show = r => '[' + r.id + '] ' + (r.text || '') +
  (r.due_at ? '  due ' + r.due_at : '  (next session)') +
  (r.recurring ? '  every ' + r.recurring.every : '') +
  (isOpen(r) ? '' : '  DONE ' + (r.completed_at || ''));

if (MODE === 'add') {
  const r = {
    id: 'rem-' + crypto.randomBytes(3).toString('hex'),
    text: TEXT,
    created_at: nowIso,
    due_at: DUE_AT,
    recurring: RECURRING,
    tags: TAGS,
    status: 'pending',
    completed_at: null,
    surface: 'claude-code'
  };
  doc.reminders.push(r);
  save();
  console.log('added ' + show(r));
} else if (MODE === 'done') {
  const r = doc.reminders.find(x => x.id === TARGET || (x.id || '').endsWith(TARGET));
  if (!r) { console.log('no reminder matching ' + TARGET); process.exit(0); }
  if (r.recurring && r.recurring.every) {
    r.due_at = bump(r.due_at, r.recurring.every) || r.due_at;
    r.last_completed_at = nowIso;
    save();
    console.log('completed, next occurrence ' + r.due_at);
  } else {
    r.status = 'done';
    r.completed_at = nowIso;
    save();
    console.log('completed ' + show(r));
  }
} else if (MODE === 'delete') {
  const before = doc.reminders.length;
  doc.reminders = doc.reminders.filter(x => !(x.id === TARGET || (x.id || '').endsWith(TARGET)));
  if (doc.reminders.length === before) { console.log('no reminder matching ' + TARGET); process.exit(0); }
  save();
  console.log('deleted ' + TARGET);
} else {
  const t = now.getTime();
  let list = doc.reminders.filter(r => SHOW_ALL || isOpen(r));
  if (MODE === 'due') list = list.filter(r => isOpen(r) && (!r.due_at || Date.parse(r.due_at) <= t));
  list.sort((a, b) => (Date.parse(a.due_at || 0) || 0) - (Date.parse(b.due_at || 0) || 0));
  if (!list.length) { console.log(MODE === 'due' ? 'nothing due' : 'no reminders'); process.exit(0); }
  list.forEach(r => console.log((isOpen(r) && (!r.due_at || Date.parse(r.due_at) <= t) ? 'DUE  ' : '     ') + show(r)));
}
```

## Reporting

- On add: confirm the text and the resolved due time in local terms, plus the id.
- On list/due: a plain list. Do not editorialize on each item.
- If a reminder is due and it names work in this repo, say what it refers to - but do
  not start doing it without asking.
