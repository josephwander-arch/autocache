'use strict';
/**
 * Autocache shared state layer.
 *
 * Node standard library only. No npm dependencies, ever.
 *
 * Contract for every function in this file:
 *   - it never throws to the caller
 *   - on any error it returns the documented fallback
 *   - every write is atomic (write <file>.tmp, then fs.renameSync)
 *
 * State root: os.homedir()/.autocache, overridable with AUTOCACHE_HOME.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const MAX_EVENT_LOG_BYTES = 5 * 1024 * 1024;

const DEFAULTS = {
  enabled: true,
  quiet: false,
  breadcrumb_nudge_after: 8,
  breadcrumb_nudge_cooldown: 25,
  step_nudge_after: 15,
  max_touched_files: 50,
  max_auto_checkpoints: 50,
  findings_scan_sessions: 25,
  max_findings_scanned: 400
};

/* ------------------------------------------------------------------ paths */

function home() {
  try {
    const override = process.env.AUTOCACHE_HOME;
    if (override && String(override).trim()) {
      return path.resolve(String(override).trim());
    }
    return path.join(os.homedir(), '.autocache');
  } catch (e) {
    return path.join('.', '.autocache');
  }
}

/** Resolve a slash-or-backslash relative path under the state root. */
function resolvePath(relPath) {
  const parts = String(relPath || '').split(/[\\/]+/).filter(Boolean);
  return path.join(home(), ...parts);
}

function ensureDir(dir) {
  try {
    fs.mkdirSync(dir, { recursive: true });
    return true;
  } catch (e) {
    return false;
  }
}

/** Make an arbitrary id safe to use as a file name. */
function safeName(id) {
  return String(id == null ? '' : id)
    .replace(/[^A-Za-z0-9._-]+/g, '_')
    .replace(/^\.+/, '_')
    .slice(0, 120) || 'unnamed';
}

/* ------------------------------------------------------------------- json */

function readJSON(relPath, fallback) {
  try {
    const raw = fs.readFileSync(resolvePath(relPath), 'utf8');
    if (!raw || !raw.trim()) return fallback;
    const parsed = JSON.parse(raw);
    return parsed === undefined ? fallback : parsed;
  } catch (e) {
    return fallback;
  }
}

/** Atomic write. Returns true on success, false on any failure. */
function writeJSON(relPath, obj) {
  try {
    const target = resolvePath(relPath);
    ensureDir(path.dirname(target));
    const tmp = target + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(obj, null, 2), 'utf8');
    fs.renameSync(tmp, target);
    return true;
  } catch (e) {
    try { fs.unlinkSync(resolvePath(relPath) + '.tmp'); } catch (e2) { /* ignore */ }
    return false;
  }
}

/* ------------------------------------------------------------------ events */

function appendEvent(obj) {
  try {
    const target = resolvePath('logs/events.jsonl');
    ensureDir(path.dirname(target));
    try {
      const st = fs.statSync(target);
      if (st.size >= MAX_EVENT_LOG_BYTES) {
        const rotated = resolvePath('logs/events.1.jsonl');
        try { fs.rmSync(rotated, { force: true }); } catch (e2) { /* ignore */ }
        fs.renameSync(target, rotated);
      }
    } catch (e2) { /* no log yet */ }
    const rec = Object.assign({ t: new Date().toISOString() }, obj || {});
    fs.appendFileSync(target, JSON.stringify(rec) + '\n', 'utf8');
    return true;
  } catch (e) {
    return false;
  }
}

/* ------------------------------------------------------------------ config */

function config() {
  const user = readJSON('config.json', {});
  const merged = Object.assign({}, DEFAULTS);
  if (user && typeof user === 'object' && !Array.isArray(user)) {
    for (const k of Object.keys(DEFAULTS)) {
      if (user[k] !== undefined && user[k] !== null) merged[k] = user[k];
    }
  }
  return merged;
}

/** True when hooks should stay completely silent (still allowed to record state). */
function silent() {
  const c = config();
  return c.enabled === false || c.quiet === true;
}

/* -------------------------------------------------------------- breadcrumb */

function stepText(step) {
  if (typeof step === 'string') return step.trim();
  if (step && typeof step === 'object') {
    const v = step.text || step.name || step.step || step.title || step.description || step.summary;
    if (typeof v === 'string') return v.trim();
  }
  return '';
}

function stepDone(step) {
  if (!step || typeof step !== 'object') return false;
  if (step.done === true || step.completed === true) return true;
  if (typeof step.status === 'string' && /^(done|complete|completed|closed)$/i.test(step.status)) return true;
  if (step.completed_at || step.done_at) return true;
  return false;
}

/**
 * Split a breadcrumb into completed and remaining step text.
 * Tolerant of several shapes because the command layer owns breadcrumb creation.
 */
function breadcrumbProgress(bc) {
  const out = { completed: [], remaining: [] };
  try {
    if (!bc || typeof bc !== 'object') return out;

    const logged = []
      .concat(Array.isArray(bc.log) ? bc.log : [])
      .concat(Array.isArray(bc.completed_steps) ? bc.completed_steps : [])
      .map(stepText)
      .filter(Boolean);

    const seen = new Set();
    const push = (bucket, text) => {
      const key = text.toLowerCase();
      if (!text || seen.has(key)) return;
      seen.add(key);
      bucket.push(text);
    };

    const steps = Array.isArray(bc.steps) ? bc.steps : [];
    for (const s of steps) {
      const text = stepText(s);
      if (!text) continue;
      const done = stepDone(s) || logged.some((t) => t.toLowerCase() === text.toLowerCase());
      push(done ? out.completed : out.remaining, text);
    }
    for (const t of logged) push(out.completed, t);
    if (Array.isArray(bc.remaining)) {
      for (const r of bc.remaining) push(out.remaining, stepText(r));
    }
  } catch (e) { /* fall through */ }
  return out;
}

/**
 * The currently open breadcrumb, or null.
 * Handles active.json holding either the full record or a { id } pointer.
 * The returned object carries __autocache_source so saveBreadcrumb knows
 * whether active.json holds the record itself.
 */
function activeBreadcrumb() {
  try {
    const active = readJSON('breadcrumbs/active.json', null);
    if (!active || typeof active !== 'object' || Array.isArray(active)) return null;

    const id = typeof active.id === 'string' ? active.id
      : (typeof active.breadcrumb_id === 'string' ? active.breadcrumb_id : null);

    const isPointer = !active.steps && !active.name && !active.title && !!id;
    if (isPointer) {
      const full = readJSON('breadcrumbs/' + safeName(id) + '.json', null);
      if (full && typeof full === 'object') {
        full.id = full.id || id;
        full.__autocache_source = 'file';
        return isOpen(full) ? full : null;
      }
      return null;
    }
    active.__autocache_source = 'active';
    if (id) active.id = id;
    return isOpen(active) ? active : null;
  } catch (e) {
    return null;
  }
}

function isOpen(bc) {
  if (!bc || typeof bc !== 'object') return false;
  if (typeof bc.status === 'string' && /^(complete|completed|closed|aborted|done)$/i.test(bc.status)) return false;
  if (bc.completed_at || bc.aborted_at || bc.closed_at) return false;
  return true;
}

/** Persist a breadcrumb obtained from activeBreadcrumb(). */
function saveBreadcrumb(bc) {
  try {
    if (!bc || typeof bc !== 'object') return false;
    const source = bc.__autocache_source;
    const copy = Object.assign({}, bc);
    delete copy.__autocache_source;
    copy.updated_at = new Date().toISOString();
    let ok = false;
    if (copy.id) ok = writeJSON('breadcrumbs/' + safeName(copy.id) + '.json', copy) || ok;
    if (source === 'active' || !copy.id) ok = writeJSON('breadcrumbs/active.json', copy) || ok;
    return ok;
  } catch (e) {
    return false;
  }
}

/* ----------------------------------------------------------------- session */

/** Normalized newest-first list of session index entries. */
function sessionIndex() {
  const raw = readJSON('sessions/index.json', null);
  let list = [];
  if (Array.isArray(raw)) list = raw;
  else if (raw && Array.isArray(raw.sessions)) list = raw.sessions;
  else if (raw && Array.isArray(raw.entries)) list = raw.entries;
  const out = [];
  for (const item of list) {
    if (typeof item === 'string') out.push({ id: item });
    else if (item && typeof item === 'object' && (item.id || item.session_id)) {
      out.push(Object.assign({}, item, { id: item.id || item.session_id }));
    }
  }
  return out;
}

/** Full record for a session id, or null. */
function sessionRecord(id) {
  if (!id) return null;
  const rec = readJSON('sessions/' + safeName(id) + '.json', null);
  if (!rec || typeof rec !== 'object' || Array.isArray(rec)) return null;
  rec.id = rec.id || id;
  return rec;
}

/** Newest-first session records, up to limit. Falls back to a directory scan. */
function recentSessions(limit) {
  const max = Math.max(1, Number(limit) || 10);
  const out = [];
  const seen = new Set();
  for (const entry of sessionIndex()) {
    if (out.length >= max) break;
    if (seen.has(entry.id)) continue;
    seen.add(entry.id);
    const rec = sessionRecord(entry.id) || entry;
    out.push(rec);
  }
  if (out.length) return out;

  // No usable index: scan the directory, newest mtime first.
  try {
    const dir = resolvePath('sessions');
    const files = fs.readdirSync(dir)
      .filter((f) => f.endsWith('.json') && f !== 'index.json')
      .slice(0, 200)
      .map((f) => {
        let m = 0;
        try { m = fs.statSync(path.join(dir, f)).mtimeMs; } catch (e) { /* ignore */ }
        return { f: f, m: m };
      })
      .sort((a, b) => b.m - a.m)
      .slice(0, max);
    for (const it of files) {
      const rec = readJSON('sessions/' + it.f, null);
      if (rec && typeof rec === 'object') {
        rec.id = rec.id || it.f.replace(/\.json$/, '');
        out.push(rec);
      }
    }
  } catch (e) { /* no sessions dir */ }
  return out;
}

/** The most recent closed-or-open session record, or null. */
function lastSession() {
  const recs = recentSessions(3);
  for (const r of recs) {
    if (r && (r.summary || r.title || r.findings || r.ended_at || r.started_at)) return r;
  }
  return recs[0] || null;
}

/** Flattened findings across recent sessions: { text, session_id, date }. */
function findings(limit) {
  const cfg = config();
  const cap = Math.max(1, Number(limit) || cfg.max_findings_scanned);
  const out = [];
  for (const rec of recentSessions(cfg.findings_scan_sessions)) {
    if (out.length >= cap) break;
    const list = Array.isArray(rec && rec.findings) ? rec.findings : [];
    const date = String(rec.ended_at || rec.updated_at || rec.started_at || '').slice(0, 10);
    for (const f of list) {
      if (out.length >= cap) break;
      const text = typeof f === 'string' ? f
        : (f && typeof f === 'object' ? (f.text || f.finding || f.summary || f.note || '') : '');
      if (!text || typeof text !== 'string') continue;
      out.push({
        text: text.trim(),
        session_id: rec.id || 'unknown',
        date: (f && typeof f === 'object' && typeof f.at === 'string' ? f.at.slice(0, 10) : date) || ''
      });
    }
  }
  return out;
}

/* --------------------------------------------------------------- reminders */

function parseWhen(v) {
  if (typeof v === 'number' && isFinite(v)) return v < 1e12 ? v * 1000 : v;
  if (typeof v === 'string' && v.trim()) {
    const n = Date.parse(v);
    if (!isNaN(n)) return n;
    const asNum = Number(v);
    if (isFinite(asNum) && asNum > 0) return asNum < 1e12 ? asNum * 1000 : asNum;
  }
  return null;
}

/** Reminders due at or before `now` (ms epoch, defaults to Date.now()). */
function dueReminders(now) {
  const at = typeof now === 'number' && isFinite(now) ? now
    : (now instanceof Date ? now.getTime() : Date.now());
  const raw = readJSON('reminders.json', null);
  let list = [];
  if (Array.isArray(raw)) list = raw;
  else if (raw && Array.isArray(raw.reminders)) list = raw.reminders;
  const out = [];
  for (const r of list) {
    if (!r) continue;
    if (typeof r === 'string') continue;
    if (r.completed === true || r.done === true) continue;
    if (typeof r.status === 'string' && /^(done|complete|completed|cancel|cancelled|canceled)$/i.test(r.status)) continue;
    const when = parseWhen(r.due_at || r.due || r.when || r.at || r.next_due_at);
    if (when === null) continue;
    if (when <= at) {
      out.push({
        id: r.id || '',
        text: String(r.text || r.title || r.message || r.note || '(no text)').trim(),
        due_at: new Date(when).toISOString(),
        recurring: !!(r.recurring || r.repeat || r.interval)
      });
    }
  }
  out.sort((a, b) => (a.due_at < b.due_at ? -1 : 1));
  return out;
}

/* -------------------------------------------------------- self-state / bag */

function selfState() {
  const s = readJSON('state/self_state.json', {});
  return s && typeof s === 'object' && !Array.isArray(s) ? s : {};
}

function bag() {
  const b = readJSON('state/bag.json', {});
  if (!b || typeof b !== 'object' || Array.isArray(b)) return {};
  return b && typeof b.tags === 'object' && b.tags && !Array.isArray(b.tags) ? b.tags : b;
}

/* ------------------------------------------------------------------- arc */

/**
 * The live work arc: tool-call counters, touched files, checkpoint pointer.
 * Not part of the documented public state contract - it is hook bookkeeping
 * that lives alongside self_state.json and bag.json.
 */
function arc() {
  const a = readJSON('state/arc.json', null);
  const base = {
    session_id: '',
    cwd: '',
    tool_calls: 0,
    touched_files: [],
    breadcrumb_id: '',
    last_checkpoint: '',
    last_breadcrumb_nudge_at: -1,
    warned_paths: [],
    auto_checkpoints: [],
    updated_at: ''
  };
  if (!a || typeof a !== 'object' || Array.isArray(a)) return base;
  return Object.assign(base, a);
}

function saveArc(next) {
  if (!next || typeof next !== 'object') return false;
  next.updated_at = new Date().toISOString();
  return writeJSON('state/arc.json', next);
}

/* ------------------------------------------------------------------ stdin */

/** Raw stdin as a string. Returns '' when stdin is absent or unreadable. */
function readStdin() {
  try {
    return fs.readFileSync(0, 'utf8');
  } catch (e) {
    return '';
  }
}

/** Parsed stdin JSON, or {} for empty, malformed, or non-object input. */
function readStdinJSON() {
  try {
    const raw = readStdin();
    if (!raw || !raw.trim()) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return parsed;
  } catch (e) {
    return {};
  }
}

/* ------------------------------------------------------------------ tools */

const WRITE_TOOL_RE = /^(write|edit|multiedit|notebookedit|create|update|str_replace|str_replace_editor|apply_patch)$/i;

function isWriteTool(name) {
  const n = String(name || '').trim();
  if (!n) return false;
  const bare = n.includes('__') ? n.split('__').pop() : n;
  return WRITE_TOOL_RE.test(bare) || /(^|_)(write|edit)_file$/i.test(bare);
}

/** File paths referenced by a tool invocation. */
function toolPaths(toolInput) {
  const out = [];
  try {
    if (!toolInput || typeof toolInput !== 'object') return out;
    const keys = ['file_path', 'filePath', 'path', 'notebook_path', 'notebookPath', 'target_file', 'file'];
    for (const k of keys) {
      const v = toolInput[k];
      if (typeof v === 'string' && v.trim()) out.push(v.trim());
    }
    const lists = ['file_paths', 'paths', 'files'];
    for (const k of lists) {
      const v = toolInput[k];
      if (Array.isArray(v)) {
        for (const item of v) if (typeof item === 'string' && item.trim()) out.push(item.trim());
      }
    }
  } catch (e) { /* ignore */ }
  return Array.from(new Set(out));
}

/** Case-normalized key for path comparison across platforms. */
function pathKey(p) {
  try {
    const resolved = path.resolve(String(p || ''));
    return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
  } catch (e) {
    return String(p || '');
  }
}

/* ----------------------------------------------------------------- helpers */

function shortId(prefix) {
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..*$/, 'Z');
  let rand = '';
  try {
    rand = require('crypto').randomBytes(3).toString('hex');
  } catch (e) {
    rand = String(Math.floor(Math.random() * 0xffffff)).padStart(6, '0');
  }
  return (prefix ? String(prefix) : 'id') + '_' + stamp + '_' + rand;
}

function truncate(s, n) {
  const str = String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
  const max = Math.max(8, Number(n) || 120);
  return str.length <= max ? str : str.slice(0, max - 3) + '...';
}

/** Merge new paths into a capped, newest-first, de-duplicated list. */
function mergeTouched(existing, incoming, cap) {
  const limit = Math.max(1, Number(cap) || 50);
  const out = [];
  const seen = new Set();
  const add = (p) => {
    if (typeof p !== 'string' || !p.trim()) return;
    const key = pathKey(p);
    if (seen.has(key)) return;
    seen.add(key);
    out.push(p.trim());
  };
  for (const p of (Array.isArray(incoming) ? incoming : [])) add(p);
  for (const p of (Array.isArray(existing) ? existing : [])) add(p);
  return out.slice(0, limit);
}

module.exports = {
  MAX_EVENT_LOG_BYTES: MAX_EVENT_LOG_BYTES,
  DEFAULTS: DEFAULTS,
  home: home,
  resolvePath: resolvePath,
  ensureDir: ensureDir,
  safeName: safeName,
  readJSON: readJSON,
  writeJSON: writeJSON,
  appendEvent: appendEvent,
  config: config,
  silent: silent,
  activeBreadcrumb: activeBreadcrumb,
  saveBreadcrumb: saveBreadcrumb,
  breadcrumbProgress: breadcrumbProgress,
  sessionIndex: sessionIndex,
  sessionRecord: sessionRecord,
  recentSessions: recentSessions,
  lastSession: lastSession,
  findings: findings,
  dueReminders: dueReminders,
  selfState: selfState,
  bag: bag,
  arc: arc,
  saveArc: saveArc,
  readStdin: readStdin,
  readStdinJSON: readStdinJSON,
  isWriteTool: isWriteTool,
  toolPaths: toolPaths,
  pathKey: pathKey,
  shortId: shortId,
  truncate: truncate,
  mergeTouched: mergeTouched
};
