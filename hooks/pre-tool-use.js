'use strict';
/**
 * Autocache PreToolUse hook.
 *
 * ADVISORY ONLY. It never blocks, never denies, never emits a permission
 * decision. It writes at most one short line to stderr and exits 0.
 *
 * Two checks:
 *   (a) the arc has run past N tool calls with no open breadcrumb -> suggest one
 *   (b) a write/edit targets a path with no recorded checkpoint -> note it
 *
 * Fails open: any error exits 0 silently.
 */

const fs = require('fs');
const path = require('path');

/**
 * Paths covered by an existing checkpoint. Cached in the arc and invalidated
 * by the checkpoints directory mtime so the common case is one stat call.
 */
function checkpointedKeys(store, a) {
  const keys = new Set();
  let dirMtime = 0;
  const dir = path.join(store.home(), 'checkpoints');
  try {
    dirMtime = fs.statSync(dir).mtimeMs;
  } catch (e) {
    return { keys: keys, mtime: 0, changed: false };
  }

  const cache = a.cp_cache && typeof a.cp_cache === 'object' ? a.cp_cache : null;
  if (cache && cache.mtime === dirMtime && Array.isArray(cache.keys)) {
    for (const k of cache.keys) keys.add(k);
    return { keys: keys, mtime: dirMtime, changed: false };
  }

  try {
    const entries = fs.readdirSync(dir)
      .filter((f) => f.endsWith('.json'))
      .slice(0, 200)
      .map((f) => {
        let m = 0;
        try { m = fs.statSync(path.join(dir, f)).mtimeMs; } catch (e) { /* ignore */ }
        return { f: f, m: m };
      })
      .sort((x, y) => y.m - x.m)
      .slice(0, 20);

    for (const e of entries) {
      const cp = store.readJSON('checkpoints/' + e.f, null);
      if (!cp || typeof cp !== 'object') continue;
      const lists = [cp.files, cp.touched_files, cp.paths];
      for (const list of lists) {
        if (!Array.isArray(list)) continue;
        for (const p of list) if (typeof p === 'string' && p.trim()) keys.add(store.pathKey(p));
      }
    }
  } catch (e) { /* ignore */ }

  return { keys: keys, mtime: dirMtime, changed: true };
}

try {
  const store = require('./lib/store.js');
  const input = store.readStdinJSON();
  const cfg = store.config();

  if (cfg.enabled === false || cfg.quiet === true) process.exit(0);

  // Native workers remain owned by the host runtime. Never let a child
  // PreToolUse event mutate the lead arc's nudge/checkpoint caches. Codex does
  // not currently guarantee agent_id on every ordinary child tool event, so
  // an untagged event is also treated as ambiguous while that parent session
  // has an active worker. The tradeoff is intentionally conservative: lead
  // advice pauses during that ambiguous window instead of misattributing a
  // child action to the lead.
  const worker = store.workerIdentity(input);
  const parentSessionId = typeof input.session_id === 'string' ? input.session_id : '';
  const ambiguousDuringWorker = !worker && parentSessionId
    && store.activeWorkerIds(parentSessionId).length > 0;
  if (worker || ambiguousDuringWorker) process.exit(0);

  const toolName = typeof input.tool_name === 'string' ? input.tool_name : '';
  const toolInput = input.tool_input && typeof input.tool_input === 'object' ? input.tool_input : {};

  const a = store.arc();
  const notes = [];
  let arcDirty = false;

  // ---- (a) long arc, no breadcrumb ---------------------------------------
  const bc = store.activeBreadcrumb();
  if (!bc) {
    const threshold = Number(cfg.breadcrumb_nudge_after) || 8;
    const cooldown = Number(cfg.breadcrumb_nudge_cooldown) || 25;
    const calls = Number(a.tool_calls) || 0;
    const lastNudge = Number(a.last_breadcrumb_nudge_at);
    const sinceNudge = isFinite(lastNudge) && lastNudge >= 0 ? calls - lastNudge : Infinity;
    if (calls >= threshold && sinceNudge >= cooldown) {
      notes.push('[autocache] ' + calls + ' tool calls into this arc with no open breadcrumb. '
        + 'Run /breadcrumb to make the work resumable.');
      a.last_breadcrumb_nudge_at = calls;
      arcDirty = true;
    }
  }

  // ---- (b) write/edit against an uncheckpointed path ---------------------
  if (store.isWriteTool(toolName)) {
    const paths = store.toolPaths(toolInput);
    if (paths.length) {
      const cp = checkpointedKeys(store, a);
      if (cp.changed) {
        a.cp_cache = { mtime: cp.mtime, keys: Array.from(cp.keys).slice(0, 500) };
        arcDirty = true;
      }
      const warned = new Set(Array.isArray(a.warned_paths) ? a.warned_paths : []);
      const fresh = [];
      for (const p of paths) {
        const key = store.pathKey(p);
        if (cp.keys.has(key) || warned.has(key)) continue;
        let exists = false;
        try { exists = fs.existsSync(p); } catch (e) { exists = false; }
        if (!exists) continue; // creating a new file needs no checkpoint
        fresh.push(p);
        warned.add(key);
      }
      if (fresh.length) {
        notes.push('[autocache] no checkpoint recorded for ' + fresh.slice(0, 3).join(', ')
          + (fresh.length > 3 ? ' (+' + (fresh.length - 3) + ' more)' : '')
          + '. Run /checkpoint first if this edit should be reversible.');
        a.warned_paths = Array.from(warned).slice(-200);
        arcDirty = true;
      }
    }
  }

  if (arcDirty) store.saveArc(a);

  if (notes.length) {
    process.stderr.write(notes.join('\n') + '\n');
    store.appendEvent({
      event: 'pre_tool_advice',
      session_id: input.session_id || '',
      tool: toolName,
      notes: notes.length
    });
  }
} catch (e) { /* fail open */ }

process.exit(0);
