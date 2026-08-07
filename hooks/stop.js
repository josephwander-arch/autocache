'use strict';
/**
 * Autocache Stop hook - the auto-checkpoint.
 *
 * Persists the current arc (open breadcrumb and its progress, session id,
 * recently touched files, tool-call count, cwd, timestamp) as a checkpoint so
 * the next SessionStart can restore it.
 *
 * This is the mechanism the whole product rests on, so it is deliberately
 * defensive: the checkpoint is written atomically, read back to confirm, and
 * retried once; the arc pointer is only moved after a confirmed write. Old
 * auto-checkpoints written by this hook are pruned; nothing else is deleted.
 *
 * It writes no stdout - a Stop hook must never interfere with turn completion.
 * Fails open: any error exits 0 silently.
 */

try {
  const store = require('./lib/store.js');
  const input = store.readStdinJSON();
  const cfg = store.config();

  if (cfg.enabled === false) process.exit(0);

  const now = new Date().toISOString();
  const a = store.arc();
  const bc = store.activeBreadcrumb();
  const prog = bc ? store.breadcrumbProgress(bc) : { completed: [], remaining: [] };
  const cap = Number(cfg.max_touched_files) || 50;

  const sessionId = (typeof input.session_id === 'string' && input.session_id)
    ? input.session_id : (a.session_id || '');
  const cwd = (typeof input.cwd === 'string' && input.cwd) ? input.cwd : (a.cwd || '');

  const touched = store.mergeTouched(
    a.touched_files,
    bc && Array.isArray(bc.touched_files) ? bc.touched_files : [],
    cap
  );

  const id = store.shortId('cp');
  const checkpoint = {
    id: id,
    kind: 'auto',
    source: 'stop-hook',
    created_at: now,
    session_id: sessionId,
    cwd: cwd,
    transcript_path: typeof input.transcript_path === 'string' ? input.transcript_path : '',
    tool_calls: Number(a.tool_calls) || 0,
    touched_files: touched,
    files: touched,
    breadcrumb: bc ? {
      id: bc.id || '',
      name: bc.name || bc.title || '',
      created_at: bc.created_at || bc.started_at || '',
      tool_calls: Number(bc.tool_calls) || 0,
      completed: prog.completed.slice(-20),
      remaining: prog.remaining.slice(0, 20),
      forked_from: bc.forked_from || null,
      forked_to: bc.forked_to || null,
      open_decisions: store.openDecisions(bc).length
    } : null,
    self_state: store.selfState(),
    bag: store.bag()
  };

  const rel = 'checkpoints/' + store.safeName(id) + '.json';
  let ok = store.writeJSON(rel, checkpoint);

  // Confirm the write landed and is parseable; retry once if not.
  let confirmed = store.readJSON(rel, null);
  if (!confirmed || confirmed.id !== id) {
    ok = store.writeJSON(rel, checkpoint);
    confirmed = store.readJSON(rel, null);
  }
  const landed = !!(ok && confirmed && confirmed.id === id);

  // ---- move the arc pointer only after a confirmed checkpoint -------------
  a.session_id = sessionId;
  a.cwd = cwd;
  a.touched_files = touched;
  a.breadcrumb_id = bc && bc.id ? bc.id : '';
  a.stopped_at = now;
  if (landed) {
    a.last_checkpoint = id;
    const autos = Array.isArray(a.auto_checkpoints) ? a.auto_checkpoints.slice() : [];
    autos.push(id);
    const keep = Math.max(5, Number(cfg.max_auto_checkpoints) || 50);
    while (autos.length > keep) {
      const old = autos.shift();
      try {
        require('fs').rmSync(store.resolvePath('checkpoints/' + store.safeName(old) + '.json'), { force: true });
      } catch (e) { /* pruning is best effort */ }
    }
    a.auto_checkpoints = autos;
  }
  store.saveArc(a);

  store.appendEvent({
    event: 'auto_checkpoint',
    session_id: sessionId,
    checkpoint_id: landed ? id : null,
    written: landed,
    tool_calls: Number(a.tool_calls) || 0,
    files: touched.length,
    breadcrumb_id: bc && bc.id ? bc.id : null,
    stop_hook_active: input.stop_hook_active === true
  });
} catch (e) { /* fail open */ }

process.exit(0);
