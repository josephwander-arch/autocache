'use strict';
/**
 * Autocache shared state layer.
 *
 * Node standard library only. No npm dependencies, ever.
 *
 * Contract for every function in this file:
 *   - it never throws to the caller
 *   - on any error it returns the documented fallback
 *   - structured JSON replacement is atomic (write <file>.tmp, then rename)
 *   - JSONL telemetry is append-only and readers must ignore a truncated tail
 *
 * State root: one universal contract, one scoped store per AI surface.
 * Base: os.homedir()/.autocache, overridable with AUTOCACHE_HOME.
 * Store: <base>/stores/<scope>, where scope is AUTOCACHE_SCOPE, else the
 * process-level surface name, else 'default'. Every surface reads and writes
 * the same format; the scoped root is what keeps concurrent sessions from
 * different AIs on one machine out of each other's state.
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
  max_findings_scanned: 400,
  max_worker_receipts_scanned: 200,
  max_worker_result_chars: 4000,
  external_breadcrumb_dirs: [],
  external_breadcrumb_owner: ''
};

/* ------------------------------------------------------------------ paths */

function baseHome() {
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

/**
 * Store scope. Explicit AUTOCACHE_SCOPE always wins, so a test harness or an
 * operator can pin several surfaces to one store deliberately. Otherwise the
 * process-level surface name (never the per-event payload, which would let a
 * single stray event switch stores mid-process). 'default' when unknown.
 */
let _scopeCache = null;
function storeScope() {
  if (_scopeCache) return _scopeCache;
  let scope = 'default';
  try {
    const explicit = process.env.AUTOCACHE_SCOPE;
    if (explicit && String(explicit).trim()) {
      scope = String(explicit).trim();
    } else {
      const surface = surfaceName(null);
      if (surface && surface !== 'unknown') scope = surface;
    }
  } catch (e) { /* keep default */ }
  _scopeCache = safeName(scope);
  return _scopeCache;
}

function home() {
  return path.join(baseHome(), 'stores', storeScope());
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
 * Log-style step entries carry a timestamp, source, or tool - they record work
 * already done. Bare text and explicitly pending entries are still open.
 */
function stepLogged(step) {
  if (!step || typeof step !== 'object') return false;
  if (typeof step.status === 'string' && /^(pending|open|todo|blocked)$/i.test(step.status)) return false;
  return !!(step.at || step.source || step.tool);
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
      const done = stepDone(s) || stepLogged(s) || logged.some((t) => t.toLowerCase() === text.toLowerCase());
      push(done ? out.completed : out.remaining, text);
    }
    for (const t of logged) push(out.completed, t);
    // Planned steps not matched by a completed one are still open. Matching
    // mirrors the command layer: a logged step covers a planned one when it
    // contains the planned text's first 24 characters.
    if (Array.isArray(bc.planned_steps)) {
      for (const p of bc.planned_steps) {
        const text = stepText(p);
        if (!text) continue;
        const key = text.toLowerCase();
        const covered = out.completed.some((t) => {
          const k = t.toLowerCase();
          return k === key || k.includes(key.slice(0, 24));
        });
        if (!covered) push(out.remaining, text);
      }
    }
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

/**
 * Persist a breadcrumb obtained from activeBreadcrumb().
 *
 * A record whose on-disk copy has been forked away (`forked_to` set) is
 * frozen: the write is refused and false is returned, so no code path can
 * mutate a dead branch by accident. Chain management (freezing a source,
 * completion propagation, retirement) passes allowFrozen = true.
 */
function saveBreadcrumb(bc, allowFrozen) {
  try {
    if (!bc || typeof bc !== 'object') return false;
    const source = bc.__autocache_source;
    const copy = Object.assign({}, bc);
    delete copy.__autocache_source;
    if (!allowFrozen && copy.id) {
      const disk = readJSON('breadcrumbs/' + safeName(copy.id) + '.json', null);
      if (disk && typeof disk === 'object' && !Array.isArray(disk) && disk.forked_to) return false;
    }
    copy.updated_at = new Date().toISOString();
    let ok = false;
    if (copy.id) ok = writeJSON('breadcrumbs/' + safeName(copy.id) + '.json', copy) || ok;
    if (source === 'active' || !copy.id) ok = writeJSON('breadcrumbs/active.json', copy) || ok;
    return ok;
  } catch (e) {
    return false;
  }
}

/* -------------------------------------------------------------- fork chain */

/** Full record for a breadcrumb id, or null. */
function readBreadcrumb(id) {
  if (!id) return null;
  const rec = readJSON('breadcrumbs/' + safeName(id) + '.json', null);
  if (!rec || typeof rec !== 'object' || Array.isArray(rec)) return null;
  rec.id = rec.id || String(id);
  return rec;
}

/** A record that has been forked away is frozen: read-only forever. */
function isFrozen(bc) {
  return !!(bc && typeof bc === 'object' && typeof bc.forked_to === 'string' && bc.forked_to);
}

/**
 * Follow forked_to pointers to the live end of the chain. Cycle-safe.
 * Returns { id, record }; record is null when the head file is missing.
 */
function chainHead(idOrRecord) {
  try {
    let rec = (idOrRecord && typeof idOrRecord === 'object') ? idOrRecord : readBreadcrumb(idOrRecord);
    if (!rec) return { id: String(idOrRecord || ''), record: null };
    const seen = new Set();
    while (isFrozen(rec) && rec.id && !seen.has(rec.id) && seen.size < 100) {
      seen.add(rec.id);
      const next = readBreadcrumb(rec.forked_to);
      if (!next) return { id: rec.forked_to, record: null };
      rec = next;
    }
    return { id: rec.id || '', record: rec };
  } catch (e) {
    return { id: '', record: null };
  }
}

/**
 * One line explaining why a frozen record rejects writes, naming the chain
 * head so the returning session catches up instead of writing a dead branch.
 * Empty string when the record is not frozen.
 */
function frozenNotice(bc) {
  try {
    if (!isFrozen(bc)) return '';
    const head = chainHead(bc);
    const headBit = head.record
      ? head.id + ' [' + (head.record.status || 'open') + ']'
      : head.id + ' (record missing)';
    return 'breadcrumb ' + (bc.id || '?') + ' is frozen: forked to ' + bc.forked_to
      + (bc.forked_by ? ' by ' + bc.forked_by : '')
      + (bc.forked_at ? ' at ' + bc.forked_at : '')
      + '. Chain head: ' + headBit + '. Catch up on the head before continuing.';
  } catch (e) {
    return '';
  }
}

/** Decisions still awaiting resolution. */
function openDecisions(bc) {
  const out = [];
  try {
    const list = bc && Array.isArray(bc.decisions) ? bc.decisions : [];
    for (const d of list) {
      if (!d || typeof d !== 'object') continue;
      if (typeof d.status === 'string' && /^(resolved|closed|done)$/i.test(d.status)) continue;
      if (d.chosen != null && d.chosen !== '') continue;
      out.push(d);
    }
  } catch (e) { /* fall through */ }
  return out;
}

/** planned_steps indexes blocked by an open decision. */
function blockedStepIndexes(bc) {
  const out = new Set();
  try {
    for (const d of openDecisions(bc)) {
      const blocks = Array.isArray(d.blocks) ? d.blocks : [];
      for (const b of blocks) {
        const n = Number(b);
        if (Number.isInteger(n) && n >= 0) out.add(n);
      }
    }
  } catch (e) { /* fall through */ }
  return out;
}

/**
 * The not-yet-done work a fork must carry: `carried` is the ordered list of
 * remaining step texts, `map` maps each old planned_steps index onto its new
 * index so decision blocks can be reindexed. Checklist-shape pending entries
 * from steps[] are appended after the planned list; they get no map entry
 * because decision blocks index planned_steps only.
 */
function remainingPlanned(bc) {
  const out = { carried: [], map: {} };
  try {
    if (!bc || typeof bc !== 'object') return out;
    const prog = breadcrumbProgress(bc);
    const completed = prog.completed.map((t) => t.toLowerCase());
    const isDone = (text) => {
      const key = text.toLowerCase();
      return completed.some((k) => k === key || k.includes(key.slice(0, 24)));
    };
    const planned = Array.isArray(bc.planned_steps) ? bc.planned_steps : [];
    planned.forEach((p, i) => {
      const text = stepText(p);
      if (!text || isDone(text)) return;
      out.map[i] = out.carried.length;
      out.carried.push(text);
    });
    const seen = new Set(out.carried.map((t) => t.toLowerCase()));
    for (const t of prog.remaining) {
      const key = t.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.carried.push(t);
    }
  } catch (e) { /* fall through */ }
  return out;
}

/**
 * Fork a live chain head: write a new breadcrumb carrying the remaining steps
 * and unresolved decisions (blocks reindexed), then freeze the source with
 * forked_to / forked_by / forked_at. The new record is written and read back
 * before the source is touched, so a crash between the two writes leaves a
 * spare record, never a frozen source with no head.
 *
 * opts: { by, surface, session_id, cwd, name, activate }. activate defaults
 * to true and repoints breadcrumbs/active.json at the new head.
 *
 * Returns { ok: true, id, record } or { ok: false, error }. Never throws.
 */
function forkBreadcrumb(sourceId, opts) {
  try {
    opts = opts && typeof opts === 'object' ? opts : {};
    const src = readBreadcrumb(sourceId);
    if (!src) return { ok: false, error: 'no breadcrumb ' + String(sourceId || '') };
    if (isFrozen(src)) {
      return { ok: false, error: frozenNotice(src) + ' Fork the head, not a frozen ancestor.' };
    }
    if (!isOpen(src)) {
      return { ok: false, error: 'breadcrumb ' + src.id + ' is ' + (src.status || 'closed') + ' - only a live head can be forked' };
    }
    const rem = remainingPlanned(src);
    const open = openDecisions(src);
    if (!rem.carried.length && !open.length) {
      return { ok: false, error: 'breadcrumb ' + src.id + ' has no remaining steps and no unresolved decisions - complete it instead of forking' };
    }

    // Guaranteed-unique id: regenerate on collision with the source or an
    // existing file, then append a discriminator suffix. A record must never
    // end up forked_to itself.
    let id = shortId('bc');
    let tries = 0;
    while ((id === src.id || fs.existsSync(resolvePath('breadcrumbs/' + safeName(id) + '.json'))) && tries < 20) {
      tries += 1;
      id = shortId('bc') + '-f' + tries;
    }
    if (id === src.id || fs.existsSync(resolvePath('breadcrumbs/' + safeName(id) + '.json'))) {
      return { ok: false, error: 'could not allocate a unique id for the fork' };
    }

    const now = new Date().toISOString();
    const decisions = open.map((d) => {
      const copy = Object.assign({}, d);
      const blocks = Array.isArray(d.blocks) ? d.blocks : [];
      copy.blocks = blocks
        .map((b) => (Object.prototype.hasOwnProperty.call(rem.map, b) ? rem.map[b] : null))
        .filter((b) => b !== null);
      return copy;
    });

    const fork = {
      version: Number(src.version) || 1,
      id: id,
      name: typeof opts.name === 'string' && opts.name ? opts.name : (src.name || src.title || ''),
      status: 'open',
      session_id: typeof opts.session_id === 'string' ? opts.session_id : null,
      surface: typeof opts.surface === 'string' && opts.surface ? opts.surface : (src.surface || ''),
      cwd: typeof opts.cwd === 'string' && opts.cwd ? opts.cwd : (src.cwd || ''),
      targets: Array.isArray(src.targets) ? src.targets.slice() : [],
      created_at: now,
      updated_at: now,
      completed_at: null,
      outcome: null,
      planned_steps: rem.carried,
      steps: [],
      decisions: decisions,
      forked_from: src.id,
      tool_calls: 0
    };

    if (!writeJSON('breadcrumbs/' + safeName(id) + '.json', fork)) {
      return { ok: false, error: 'could not write the fork record - source left untouched' };
    }
    const confirmed = readJSON('breadcrumbs/' + safeName(id) + '.json', null);
    if (!confirmed || confirmed.id !== id) {
      return { ok: false, error: 'fork record did not read back - source left untouched' };
    }

    src.forked_to = id;
    src.forked_by = typeof opts.by === 'string' && opts.by ? opts.by
      : (typeof opts.surface === 'string' ? opts.surface : '');
    src.forked_at = now;
    if (!saveBreadcrumb(src, false)) {
      // Another session froze the source first: withdraw our record and
      // report the head that beat us there.
      try { fs.rmSync(resolvePath('breadcrumbs/' + safeName(id) + '.json'), { force: true }); } catch (e2) { /* ignore */ }
      const again = readBreadcrumb(src.id);
      return {
        ok: false,
        error: again && isFrozen(again) ? frozenNotice(again) : ('could not freeze ' + src.id)
      };
    }

    if (opts.activate !== false) {
      writeJSON('breadcrumbs/active.json', { version: 1, breadcrumb_id: id, updated_at: now });
    }
    appendEvent({ event: 'breadcrumb_fork', breadcrumb_id: id, forked_from: src.id, by: src.forked_by || '' });
    return { ok: true, id: id, record: fork };
  } catch (e) {
    return { ok: false, error: 'fork failed: ' + (e && e.message ? e.message : 'unknown error') };
  }
}

/**
 * Completing a head closes its ancestry: walk forked_from and mark every
 * still-open ancestor complete with completed_via = the head id, so an
 * earlier session resumes into "finished elsewhere, here is the pointer"
 * rather than a dangling operation. Returns the ids closed. Never throws.
 */
function propagateCompletion(headIdOrRecord) {
  const closed = [];
  try {
    const head = (headIdOrRecord && typeof headIdOrRecord === 'object')
      ? headIdOrRecord : readBreadcrumb(headIdOrRecord);
    if (!head || !head.id) return closed;
    const now = new Date().toISOString();
    const seen = new Set([head.id]);
    let cur = head;
    while (cur && typeof cur.forked_from === 'string' && cur.forked_from
      && !seen.has(cur.forked_from) && seen.size <= 100) {
      seen.add(cur.forked_from);
      const anc = readBreadcrumb(cur.forked_from);
      if (!anc) break;
      if (isOpen(anc)) {
        anc.status = 'complete';
        anc.completed_at = now;
        anc.completed_via = head.id;
        if (!anc.outcome) anc.outcome = 'completed via ' + head.id;
        if (saveBreadcrumb(anc, true)) closed.push(anc.id);
      }
      cur = anc;
    }
    if (closed.length) {
      appendEvent({ event: 'breadcrumb_chain_complete', head: head.id, closed: closed });
    }
  } catch (e) { /* fall through */ }
  return closed;
}

/**
 * Explicitly retire an incomplete chain with a recorded reason. Walks from
 * the chain head back through forked_from and closes every record still open
 * as aborted, with retired = true and the reason. This is the only sanctioned
 * way to make an unfinished chain stop surfacing. Returns the ids retired.
 */
function retireChain(idOrRecord, reason, by) {
  const retired = [];
  try {
    const start = (idOrRecord && typeof idOrRecord === 'object')
      ? idOrRecord : readBreadcrumb(idOrRecord);
    if (!start) return retired;
    const now = new Date().toISOString();
    const head = chainHead(start);
    let cur = head.record || start;
    const seen = new Set();
    while (cur && cur.id && !seen.has(cur.id) && seen.size <= 100) {
      seen.add(cur.id);
      if (isOpen(cur)) {
        cur.status = 'aborted';
        cur.aborted_at = now;
        cur.retired = true;
        cur.retired_reason = String(reason == null ? '' : reason);
        cur.retired_by = String(by == null ? '' : by);
        if (!cur.outcome) cur.outcome = 'retired: ' + (cur.retired_reason || '(no reason recorded)');
        if (saveBreadcrumb(cur, true)) retired.push(cur.id);
      }
      cur = (typeof cur.forked_from === 'string' && cur.forked_from) ? readBreadcrumb(cur.forked_from) : null;
    }
    if (retired.length) {
      appendEvent({ event: 'breadcrumb_chain_retire', retired: retired, reason: String(reason == null ? '' : reason) });
    }
  } catch (e) { /* fall through */ }
  return retired;
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

/* ---------------------------------------------------------- native workers */

function surfaceName(input) {
  try {
    if (input && typeof input.surface === 'string' && input.surface.trim()) {
      return input.surface.trim();
    }
    for (const arg of process.argv.slice(2)) {
      if (typeof arg === 'string' && arg.indexOf('--surface=') === 0) {
        return arg.slice('--surface='.length).trim();
      }
    }
    if (process.env.AUTOCACHE_SURFACE) return String(process.env.AUTOCACHE_SURFACE).trim();
    if (process.env.CLAUDE_PLUGIN_ROOT) return 'claude-code';
  } catch (e) { /* fall through */ }
  return 'unknown';
}

/**
 * Normalize the stable worker identity supplied by native hook runtimes.
 * No agent_id means main-thread work; never infer worker identity from a tool
 * name, cwd, transcript path, or timing.
 */
function workerIdentity(input) {
  try {
    if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
    const workerId = typeof input.agent_id === 'string' ? input.agent_id.trim() : '';
    if (!workerId) return null;
    return {
      parent_session_id: typeof input.session_id === 'string' && input.session_id.trim()
        ? input.session_id.trim() : 'unknown-session',
      worker_id: workerId,
      worker_type: typeof input.agent_type === 'string' ? input.agent_type.trim() : '',
      surface: surfaceName(input)
    };
  } catch (e) {
    return null;
  }
}

function workerDir(identity) {
  if (!identity) return '';
  return 'workers/' + safeName(identity.parent_session_id) + '/' + safeName(identity.worker_id);
}

function breadcrumbSnapshot() {
  const out = { breadcrumb_id: null, chain_head_id: null, breadcrumb_source: null };
  try {
    const bc = activeBreadcrumb();
    if (bc && bc.id) {
      out.breadcrumb_id = bc.id;
      const head = chainHead(bc);
      out.chain_head_id = head && head.id ? head.id : out.breadcrumb_id;
      out.breadcrumb_source = 'autocache';
      return out;
    }
    // No usable local tag (no arc, or a record without an id): bridge.
    return externalBreadcrumbSnapshot();
  } catch (e) { /* fall through */ }
  return out;
}

/**
 * Shared-tag bridge (ruling 2026-08-11): Autocache and a co-resident external
 * tracker (CPC autonomous) share one tag vocabulary and never run for the same
 * AI on the same machine at the same time. When no Autocache breadcrumb is
 * open, receipts bind to the newest active external breadcrumb owned by this
 * surface's actor instead of recording null. Configured per machine via
 * config.json external_breadcrumb_dirs / external_breadcrumb_owner; both empty
 * by default, so this is inert everywhere the bridge is not deliberately on.
 */
function externalBreadcrumbSnapshot() {
  const out = { breadcrumb_id: null, chain_head_id: null, breadcrumb_source: null };
  try {
    const cfg = config();
    const dirs = Array.isArray(cfg.external_breadcrumb_dirs)
      ? cfg.external_breadcrumb_dirs.slice(0, 4) : [];
    if (!dirs.length) return out;
    const owner = typeof cfg.external_breadcrumb_owner === 'string' && cfg.external_breadcrumb_owner.trim()
      ? cfg.external_breadcrumb_owner.trim()
      : storeScope().replace(/-/g, '_');
    let best = null;
    for (const dir of dirs) {
      let names = [];
      try {
        names = fs.readdirSync(String(dir)).filter((n) => n.endsWith('.json')).slice(0, 100);
      } catch (e) { continue; }
      for (const name of names) {
        try {
          const rec = JSON.parse(fs.readFileSync(path.join(String(dir), name), 'utf8'));
          if (!rec || typeof rec !== 'object' || Array.isArray(rec) || !rec.id) continue;
          if (owner && typeof rec.owner === 'string' && rec.owner !== owner) continue;
          const at = String(rec.last_activity_at || rec.started_at || '');
          if (!best || at > best.at) best = { id: String(rec.id), at: at };
        } catch (e) { /* ignore one unreadable record */ }
      }
    }
    if (best) {
      out.breadcrumb_id = best.id;
      out.chain_head_id = best.id;
      out.breadcrumb_source = 'external';
    }
  } catch (e) { /* fall through */ }
  return out;
}

/**
 * Bounded search of the external tracker's records for an exact reconciliation
 * marker: the configured active dir plus a sibling 'completed' tree, newest
 * first, hard-capped so a large archive cannot stall a hook.
 */
function externalRecordHasMarker(marker) {
  try {
    const cfg = config();
    const dirs = Array.isArray(cfg.external_breadcrumb_dirs)
      ? cfg.external_breadcrumb_dirs.slice(0, 4) : [];
    if (!dirs.length || !marker) return false;
    const files = [];
    const collect = (root, depth) => {
      let entries = [];
      try { entries = fs.readdirSync(root, { withFileTypes: true }); } catch (e) { return; }
      for (const entry of entries) {
        if (files.length >= 300) return;
        const full = path.join(root, entry.name);
        if (entry.isDirectory()) {
          if (depth > 0) collect(full, depth - 1);
        } else if (entry.name.endsWith('.json')) {
          let mtime = 0;
          try { mtime = fs.statSync(full).mtimeMs; } catch (e) { /* ignore */ }
          files.push({ full: full, mtime: mtime });
        }
      }
    };
    for (const dir of dirs) {
      collect(String(dir), 1);
      collect(path.join(path.dirname(String(dir)), 'completed'), 2);
    }
    files.sort((a, b) => b.mtime - a.mtime);
    for (const file of files.slice(0, 150)) {
      try {
        const stat = fs.statSync(file.full);
        if (stat.size > 512 * 1024) continue;
        if (fs.readFileSync(file.full, 'utf8').indexOf(marker) !== -1) return true;
      } catch (e) { /* ignore one unreadable record */ }
    }
  } catch (e) { /* not reconciled */ }
  return false;
}

function appendWorkerEvent(input, data) {
  try {
    const identity = workerIdentity(input);
    if (!identity) return false;
    const rel = workerDir(identity) + '/events.jsonl';
    const target = resolvePath(rel);
    ensureDir(path.dirname(target));
    const rec = Object.assign({
      version: 1,
      recorded_at: new Date().toISOString(),
      parent_session_id: identity.parent_session_id,
      worker_id: identity.worker_id,
      worker_type: identity.worker_type,
      surface: identity.surface
    }, data || {});
    fs.appendFileSync(target, JSON.stringify(rec) + '\n', 'utf8');
    return true;
  } catch (e) {
    return false;
  }
}

function latestWorkerReceipt(identity, kind) {
  try {
    const dir = resolvePath(workerDir(identity));
    const prefix = String(kind || '') + '_';
    const files = fs.readdirSync(dir)
      .filter((name) => name.indexOf(prefix) === 0 && name.endsWith('.json'))
      .map((name) => {
        let mtime = 0;
        try { mtime = fs.statSync(path.join(dir, name)).mtimeMs; } catch (e) { /* ignore */ }
        return { name: name, mtime: mtime };
      })
      .sort((a, b) => b.mtime - a.mtime);
    if (!files.length) return null;
    const raw = fs.readFileSync(path.join(dir, files[0].name), 'utf8');
    const rec = JSON.parse(raw);
    return rec && typeof rec === 'object' && !Array.isArray(rec) ? rec : null;
  } catch (e) {
    return null;
  }
}

/** Native workers that have a start receipt newer than their latest stop. */
function activeWorkerIds(parentSessionId) {
  const out = [];
  try {
    const parent = safeName(parentSessionId || 'unknown-session');
    const root = resolvePath('workers/' + parent);
    const entries = fs.readdirSync(root, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name === 'unattributed') continue;
      const dir = path.join(root, entry.name);
      const latest = (prefix) => {
        let found = null;
        for (const name of fs.readdirSync(dir)) {
          if (name.indexOf(prefix + '_') !== 0 || !name.endsWith('.json')) continue;
          const full = path.join(dir, name);
          let mtime = 0;
          try { mtime = fs.statSync(full).mtimeMs; } catch (e) { /* ignore */ }
          if (!found || mtime > found.mtime) found = { full: full, mtime: mtime };
        }
        if (!found) return null;
        try {
          const rec = JSON.parse(fs.readFileSync(found.full, 'utf8'));
          return { record: rec, mtime: found.mtime };
        } catch (e) {
          return null;
        }
      };
      const start = latest('start');
      const stop = latest('stop');
      if (!start) continue;
      const startAt = Date.parse(start.record.recorded_at || '') || start.mtime;
      const stopAt = stop ? (Date.parse(stop.record.recorded_at || '') || stop.mtime) : -1;
      if (!stop || startAt > stopAt) out.push(start.record.worker_id || entry.name);
    }
  } catch (e) { /* no active workers */ }
  return out;
}

/**
 * Codex does not currently promise agent_id on child PostToolUse payloads.
 * While a native worker is active, an untagged Codex event is ambiguous: keep
 * it out of the lead arc and preserve it in a session-level quarantine stream.
 */
function recordUnattributedWorkerTool(input, toolName, touched, activeIds) {
  try {
    const parent = typeof input.session_id === 'string' && input.session_id
      ? input.session_id : 'unknown-session';
    const target = resolvePath('workers/' + safeName(parent) + '/unattributed/events.jsonl');
    ensureDir(path.dirname(target));
    const rec = {
      version: 1,
      recorded_at: new Date().toISOString(),
      event: 'worker_tool_unattributed',
      surface: surfaceName(input),
      parent_session_id: parent,
      active_worker_ids: Array.isArray(activeIds) ? activeIds.slice(0, 20) : [],
      tool: String(toolName || ''),
      tool_use_id: typeof input.tool_use_id === 'string' ? input.tool_use_id : '',
      write_paths: Array.isArray(touched) ? touched.slice(0, 10) : []
    };
    fs.appendFileSync(target, JSON.stringify(rec) + '\n', 'utf8');
    return true;
  } catch (e) {
    return false;
  }
}

function writeWorkerReceipt(kind, input, extra) {
  try {
    const identity = workerIdentity(input);
    if (!identity) return null;
    const snap = breadcrumbSnapshot();
    let receiptId = shortId('wr');
    let rel = workerDir(identity) + '/' + kind + '_' + safeName(receiptId) + '.json';
    let tries = 0;
    while (fs.existsSync(resolvePath(rel)) && tries < 20) {
      tries += 1;
      receiptId = shortId('wr') + '-' + tries;
      rel = workerDir(identity) + '/' + kind + '_' + safeName(receiptId) + '.json';
    }
    if (fs.existsSync(resolvePath(rel))) return null;
    const rec = Object.assign({
      version: 1,
      receipt_id: receiptId,
      event: kind === 'start' ? 'worker_start' : 'worker_stop',
      recorded_at: new Date().toISOString(),
      parent_session_id: identity.parent_session_id,
      worker_id: identity.worker_id,
      worker_type: identity.worker_type,
      surface: identity.surface,
      cwd: typeof input.cwd === 'string' ? input.cwd : '',
      turn_id: typeof input.turn_id === 'string' ? input.turn_id : '',
      breadcrumb_id: snap.breadcrumb_id,
      chain_head_id: snap.chain_head_id,
      breadcrumb_source: snap.breadcrumb_source
    }, extra || {});
    if (!writeJSON(rel, rec)) return null;
    rec.relative_path = rel;
    appendWorkerEvent(input, {
      event: rec.event,
      receipt_id: receiptId,
      breadcrumb_id: rec.breadcrumb_id,
      chain_head_id: rec.chain_head_id
    });
    appendEvent({
      event: rec.event,
      session_id: identity.parent_session_id,
      worker_id: identity.worker_id,
      worker_type: identity.worker_type,
      receipt_id: receiptId,
      breadcrumb_id: rec.breadcrumb_id
    });
    return rec;
  } catch (e) {
    return null;
  }
}

function recordWorkerStart(input) {
  return writeWorkerReceipt('start', input, {
    permission_mode: typeof input.permission_mode === 'string' ? input.permission_mode : ''
  });
}

function recordWorkerStop(input) {
  try {
    const identity = workerIdentity(input);
    if (!identity) return null;
    const start = latestWorkerReceipt(identity, 'start');
    const cap = Math.max(200, Number(config().max_worker_result_chars) || 4000);
    const extra = {
      start_receipt_id: start && start.receipt_id ? start.receipt_id : null,
      breadcrumb_id_at_start: start && start.breadcrumb_id ? start.breadcrumb_id : null,
      chain_head_id_at_start: start && start.chain_head_id ? start.chain_head_id : null,
      agent_transcript_path: typeof input.agent_transcript_path === 'string'
        ? input.agent_transcript_path : '',
      final_message: typeof input.last_assistant_message === 'string'
        ? truncate(input.last_assistant_message, cap) : '',
      stop_hook_active: input.stop_hook_active === true
    };
    if (!start) return quarantineWorkerStop(input, identity, extra);
    return writeWorkerReceipt('stop', input, extra);
  } catch (e) {
    return null;
  }
}

/**
 * A stop with no matching start receipt is unattributable: nothing proves a
 * native worker ever ran. Observed live 2026-08-11: the runtime delivered
 * stop events on conversation turn boundaries whose final_message was
 * user-shaped text never typed into the session - plausible answers to
 * questions the assistant had just asked. Such content may still be a genuine
 * inbound message from another channel, so it is preserved verbatim for human
 * review - but it must never be recorded as a worker result, never surfaced
 * for lead reconciliation, and never replayed as an instruction.
 */
function quarantineWorkerStop(input, identity, extra) {
  try {
    let receiptId = shortId('qr');
    const dirRel = 'quarantine/' + safeName(identity.parent_session_id)
      + '/' + safeName(identity.worker_id);
    let rel = dirRel + '/stop_' + safeName(receiptId) + '.json';
    let tries = 0;
    while (fs.existsSync(resolvePath(rel)) && tries < 20) {
      tries += 1;
      receiptId = shortId('qr') + '-' + tries;
      rel = dirRel + '/stop_' + safeName(receiptId) + '.json';
    }
    if (fs.existsSync(resolvePath(rel))) return null;
    let transcriptExists = false;
    try {
      transcriptExists = !!(extra.agent_transcript_path
        && fs.existsSync(extra.agent_transcript_path));
    } catch (e) { /* stays false */ }
    const rec = Object.assign({
      version: 1,
      receipt_id: receiptId,
      event: 'worker_stop_quarantined',
      quarantined: true,
      quarantine_reason: 'no_matching_start_receipt',
      untrusted_content: true,
      recorded_at: new Date().toISOString(),
      parent_session_id: identity.parent_session_id,
      worker_id: identity.worker_id,
      worker_type: identity.worker_type,
      surface: identity.surface,
      cwd: typeof input.cwd === 'string' ? input.cwd : '',
      turn_id: typeof input.turn_id === 'string' ? input.turn_id : '',
      transcript_exists: transcriptExists
    }, extra || {});
    if (!writeJSON(rel, rec)) return null;
    rec.relative_path = rel;
    appendEvent({
      event: 'worker_stop_quarantined',
      session_id: identity.parent_session_id,
      worker_id: identity.worker_id,
      receipt_id: receiptId,
      reason: rec.quarantine_reason
    });
    return rec;
  } catch (e) {
    return null;
  }
}

/**
 * Move already-recorded worker dirs that hold stops but no start into the
 * quarantine tree. Cleans phantom receipts written before fail-closed stops
 * existed; bounded, and a dir that cannot move is left in place.
 */
function sweepOrphanStops() {
  let moved = 0;
  try {
    const root = resolvePath('workers');
    for (const parent of fs.readdirSync(root, { withFileTypes: true })) {
      if (!parent.isDirectory()) continue;
      const pdir = path.join(root, parent.name);
      let children = [];
      try { children = fs.readdirSync(pdir, { withFileTypes: true }); } catch (e) { continue; }
      for (const w of children) {
        if (!w.isDirectory() || w.name === 'unattributed') continue;
        const wdir = path.join(pdir, w.name);
        let hasStart = false;
        let hasStop = false;
        try {
          for (const n of fs.readdirSync(wdir)) {
            if (n.indexOf('start_') === 0 && n.endsWith('.json')) hasStart = true;
            if (n.indexOf('stop_') === 0 && n.endsWith('.json')) hasStop = true;
          }
        } catch (e) { continue; }
        if (hasStop && !hasStart) {
          const dest = resolvePath('quarantine/' + parent.name + '/' + w.name);
          if (fs.existsSync(dest)) continue;
          ensureDir(path.dirname(dest));
          try { fs.renameSync(wdir, dest); moved += 1; } catch (e) { /* leave in place */ }
        }
        if (moved >= 50) break;
      }
      if (moved >= 50) break;
    }
  } catch (e) { /* fail open */ }
  if (moved) {
    appendEvent({ event: 'orphan_stops_quarantined', moved: moved });
  }
  return moved;
}

/** Count quarantined stop receipts, bounded so a hook can print it cheaply. */
function quarantinedCount() {
  let count = 0;
  try {
    const root = resolvePath('quarantine');
    const walk = (dir, depth) => {
      let entries = [];
      try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return; }
      for (const entry of entries) {
        if (count >= 500) return;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (depth > 0) walk(full, depth - 1);
        } else if (entry.name.indexOf('stop_') === 0 && entry.name.endsWith('.json')) {
          count += 1;
        }
      }
    };
    walk(root, 3);
  } catch (e) { /* fail open */ }
  return count;
}

/**
 * First run of a scoped store seeds continuity state from the legacy shared
 * root. Copy, never move: other surfaces may still run older hooks against
 * the legacy layout, and their state is not this store's to relocate.
 */
function seedScopedStore() {
  try {
    const base = baseHome();
    const root = home();
    if (fs.existsSync(path.join(root, 'state', 'seed.json'))) return false;
    if (fs.existsSync(path.join(root, 'state', 'arc.json'))) return false;
    if (!fs.existsSync(path.join(base, 'state'))) return false;
    const entries = ['config.json', 'state', 'breadcrumbs', 'checkpoints', 'sessions', 'reminders'];
    const copied = [];
    for (const name of entries) {
      const src = path.join(base, name);
      if (!fs.existsSync(src)) continue;
      const dst = path.join(root, name);
      try {
        if (name === 'config.json') {
          if (!fs.existsSync(dst)) {
            ensureDir(root);
            fs.copyFileSync(src, dst);
            copied.push(name);
          }
        } else {
          fs.cpSync(src, dst, { recursive: true, force: false, errorOnExist: false });
          copied.push(name);
        }
      } catch (e) { /* per-entry fail open */ }
    }
    writeJSON('state/seed.json', {
      version: 1,
      seeded_at: new Date().toISOString(),
      seeded_from: base,
      entries: copied
    });
    appendEvent({ event: 'store_seeded', from: base, entries: copied });
    return true;
  } catch (e) {
    return false;
  }
}

function recordWorkerTool(input, toolName, touched) {
  return appendWorkerEvent(input, {
    event: 'worker_tool',
    tool: String(toolName || ''),
    tool_use_id: typeof input.tool_use_id === 'string' ? input.tool_use_id : '',
    write_paths: Array.isArray(touched) ? touched.slice(0, 10) : []
  });
}

function recordNativeTeamEvent(input) {
  try {
    if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
    const event = typeof input.hook_event_name === 'string' ? input.hook_event_name : '';
    if (!/^(TaskCreated|TaskCompleted|TeammateIdle)$/.test(event)) return null;
    const parentSession = typeof input.session_id === 'string' && input.session_id
      ? input.session_id : 'unknown-session';
    const teamName = typeof input.team_name === 'string' && input.team_name
      ? input.team_name : 'unknown-team';
    let receiptId = shortId('tr');
    const snap = breadcrumbSnapshot();
    const rec = {
      version: 1,
      receipt_id: receiptId,
      event: event,
      recorded_at: new Date().toISOString(),
      parent_session_id: parentSession,
      surface: surfaceName(input),
      team_name: teamName,
      teammate_name: typeof input.teammate_name === 'string' ? input.teammate_name : '',
      task_id: typeof input.task_id === 'string' ? input.task_id : '',
      task_subject: typeof input.task_subject === 'string' ? truncate(input.task_subject, 300) : '',
      task_description: typeof input.task_description === 'string' ? truncate(input.task_description, 1000) : '',
      cwd: typeof input.cwd === 'string' ? input.cwd : '',
      breadcrumb_id: snap.breadcrumb_id,
      chain_head_id: snap.chain_head_id
    };
    let rel = 'teams/' + safeName(parentSession) + '/' + safeName(teamName)
      + '/' + safeName(event.toLowerCase()) + '_' + safeName(receiptId) + '.json';
    let tries = 0;
    while (fs.existsSync(resolvePath(rel)) && tries < 20) {
      tries += 1;
      receiptId = shortId('tr') + '-' + tries;
      rec.receipt_id = receiptId;
      rel = 'teams/' + safeName(parentSession) + '/' + safeName(teamName)
        + '/' + safeName(event.toLowerCase()) + '_' + safeName(receiptId) + '.json';
    }
    if (fs.existsSync(resolvePath(rel))) return null;
    if (!writeJSON(rel, rec)) return null;
    rec.relative_path = rel;
    appendEvent({
      event: 'native_team_' + event.toLowerCase(),
      session_id: parentSession,
      team_name: teamName,
      teammate_name: rec.teammate_name,
      task_id: rec.task_id,
      receipt_id: receiptId,
      breadcrumb_id: rec.breadcrumb_id
    });
    return rec;
  } catch (e) {
    return null;
  }
}

function collectWorkerStops() {
  const out = [];
  const cap = Math.max(10, Number(config().max_worker_receipts_scanned) || 200);
  try {
    const root = resolvePath('workers');
    const walk = (dir) => {
      if (out.length >= cap * 4) return;
      let entries = [];
      try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return; }
      for (const entry of entries) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (entry.isFile() && /^stop_.*\.json$/.test(entry.name)) {
          let mtime = 0;
          try { mtime = fs.statSync(full).mtimeMs; } catch (e) { /* ignore */ }
          out.push({ full: full, mtime: mtime });
        }
      }
    };
    walk(root);
  } catch (e) { /* no worker directory */ }
  out.sort((a, b) => b.mtime - a.mtime);
  return out.slice(0, cap);
}

function breadcrumbRecordHasMarker(bc, marker) {
  try {
    if (!bc || typeof bc !== 'object') return false;
    const lists = []
      .concat(Array.isArray(bc.steps) ? bc.steps : [])
      .concat(Array.isArray(bc.log) ? bc.log : [])
      .concat(Array.isArray(bc.completed_steps) ? bc.completed_steps : []);
    return lists.some((step) => stepText(step).indexOf(marker) !== -1);
  } catch (e) {
    return false;
  }
}

function receiptReconciled(rec) {
  try {
    if (!rec || !rec.receipt_id) return false;
    const marker = '[worker:' + rec.receipt_id + ']';
    const ids = [rec.chain_head_id, rec.chain_head_id_at_start, rec.breadcrumb_id, rec.breadcrumb_id_at_start]
      .filter((v, i, a) => typeof v === 'string' && v && a.indexOf(v) === i);
    const seen = new Set();
    for (const id of ids) {
      let cur = chainHead(id).record || readBreadcrumb(id);
      while (cur && cur.id && !seen.has(cur.id) && seen.size < 100) {
        seen.add(cur.id);
        if (breadcrumbRecordHasMarker(cur, marker)) return true;
        cur = cur.forked_from ? readBreadcrumb(cur.forked_from) : null;
      }
    }

    // A worker may start before a breadcrumb opens. Bounded fallback: search
    // recent breadcrumb records for the exact marker rather than losing the
    // receipt or treating an unrelated summary as acknowledgement. Guarded in
    // its own try: a store with no local breadcrumbs dir (bridge-only use)
    // must still fall through to the external check below, not abort.
    try {
      const dir = resolvePath('breadcrumbs');
      const files = fs.readdirSync(dir)
        .filter((name) => name.endsWith('.json') && name !== 'active.json')
        .map((name) => {
          let mtime = 0;
          try { mtime = fs.statSync(path.join(dir, name)).mtimeMs; } catch (e) { /* ignore */ }
          return { name: name, mtime: mtime };
        })
        .sort((a, b) => b.mtime - a.mtime)
        .slice(0, 200);
      for (const file of files) {
        const bc = readJSON('breadcrumbs/' + file.name, null);
        if (breadcrumbRecordHasMarker(bc, marker)) return true;
      }
    } catch (e) { /* no local records - external check still runs */ }
    // Shared-tag bridge: the lead may have reconciled in the external
    // tracker's records rather than a local Autocache breadcrumb.
    if (externalRecordHasMarker(marker)) return true;
  } catch (e) { /* not reconciled */ }
  return false;
}

/** Latest unreconciled stop receipt per native worker. */
function pendingWorkerReceipts(limit) {
  const max = Math.max(1, Number(limit) || 5);
  const latest = new Map();
  for (const item of collectWorkerStops()) {
    let rec = null;
    try { rec = JSON.parse(fs.readFileSync(item.full, 'utf8')); } catch (e) { /* ignore */ }
    if (!rec || typeof rec !== 'object' || !rec.receipt_id) continue;
    // Unattributable stops (no start receipt) are never worker results.
    // New ones land in quarantine/, but legacy phantoms written before
    // fail-closed stops existed can still sit in workers/ - skip them.
    if (!rec.start_receipt_id) continue;
    const key = String(rec.parent_session_id || '') + '::' + String(rec.worker_id || '');
    if (!latest.has(key)) latest.set(key, rec);
  }
  const out = [];
  for (const rec of latest.values()) {
    if (!receiptReconciled(rec)) out.push(rec);
    if (out.length >= max) break;
  }
  return out;
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
    frozen_warned_id: '',
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
  baseHome: baseHome,
  storeScope: storeScope,
  seedScopedStore: seedScopedStore,
  sweepOrphanStops: sweepOrphanStops,
  quarantinedCount: quarantinedCount,
  externalBreadcrumbSnapshot: externalBreadcrumbSnapshot,
  externalRecordHasMarker: externalRecordHasMarker,
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
  isOpen: isOpen,
  readBreadcrumb: readBreadcrumb,
  isFrozen: isFrozen,
  chainHead: chainHead,
  frozenNotice: frozenNotice,
  openDecisions: openDecisions,
  blockedStepIndexes: blockedStepIndexes,
  remainingPlanned: remainingPlanned,
  forkBreadcrumb: forkBreadcrumb,
  propagateCompletion: propagateCompletion,
  retireChain: retireChain,
  sessionIndex: sessionIndex,
  sessionRecord: sessionRecord,
  recentSessions: recentSessions,
  lastSession: lastSession,
  findings: findings,
  surfaceName: surfaceName,
  workerIdentity: workerIdentity,
  activeWorkerIds: activeWorkerIds,
  appendWorkerEvent: appendWorkerEvent,
  recordWorkerStart: recordWorkerStart,
  recordWorkerStop: recordWorkerStop,
  recordWorkerTool: recordWorkerTool,
  recordUnattributedWorkerTool: recordUnattributedWorkerTool,
  recordNativeTeamEvent: recordNativeTeamEvent,
  pendingWorkerReceipts: pendingWorkerReceipts,
  receiptReconciled: receiptReconciled,
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
