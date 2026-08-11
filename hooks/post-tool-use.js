'use strict';
/**
 * Autocache PostToolUse hook.
 *
 * Counts the tool call against the arc and, when a breadcrumb is open, against
 * the breadcrumb: increments its tool-call counter and records touched files.
 * When the calls since the last logged step pass a threshold, it writes one
 * nudge to stderr. It never blocks.
 *
 * Fails open: any error exits 0 silently.
 */

try {
  const store = require('./lib/store.js');
  const input = store.readStdinJSON();
  const cfg = store.config();

  if (cfg.enabled === false) process.exit(0);

  const toolName = typeof input.tool_name === 'string' ? input.tool_name : '';
  const toolInput = input.tool_input && typeof input.tool_input === 'object' ? input.tool_input : {};
  const cap = Number(cfg.max_touched_files) || 50;

  const touched = store.isWriteTool(toolName) ? store.toolPaths(toolInput) : [];

  // Native workers keep their own event stream. They never increment or write
  // the lead's arc or active breadcrumb. Claude documents agent_id on tool
  // hooks inside subagents; Codex and future adapters get the same isolation
  // whenever they supply that stable field. No heuristic identity guessing.
  if (store.workerIdentity(input)) {
    store.recordWorkerTool(input, toolName, touched);
    process.exit(0);
  }

  // Codex documents stable identity at worker start/stop, but not on every
  // child tool event. During that ambiguous interval, preserve untagged events
  // in a quarantine stream rather than risk counting a child action against
  // the lead. This can omit a simultaneous lead counter; it cannot corrupt the
  // durable owner. A new parent session naturally has no active-worker set.
  if (store.surfaceName(input).toLowerCase() === 'codex') {
    const activeIds = store.activeWorkerIds(input.session_id || '');
    if (activeIds.length) {
      store.recordUnattributedWorkerTool(input, toolName, touched, activeIds);
      process.exit(0);
    }
  }

  // ---- arc counters -------------------------------------------------------
  const a = store.arc();
  a.tool_calls = (Number(a.tool_calls) || 0) + 1;
  if (typeof input.session_id === 'string' && input.session_id) a.session_id = input.session_id;
  if (typeof input.cwd === 'string' && input.cwd) a.cwd = input.cwd;
  if (touched.length) a.touched_files = store.mergeTouched(a.touched_files, touched, cap);

  // ---- breadcrumb ---------------------------------------------------------
  const bc = store.activeBreadcrumb();
  let nudge = '';
  if (bc && store.isFrozen(bc)) {
    // The pointer names a record another session forked away. Frozen records
    // are read-only: never step them, never count against them. One advisory
    // line per record names the chain head so the returning session catches
    // up instead of writing into a dead branch.
    a.breadcrumb_id = bc.id || a.breadcrumb_id || '';
    if (cfg.quiet !== true && a.frozen_warned_id !== (bc.id || '')) {
      const notice = store.frozenNotice(bc);
      if (notice) nudge = '[autocache] ' + notice;
      a.frozen_warned_id = bc.id || '';
    }
  } else if (bc) {
    a.breadcrumb_id = bc.id || a.breadcrumb_id || '';
    bc.tool_calls = (Number(bc.tool_calls) || 0) + 1;
    if (touched.length) bc.touched_files = store.mergeTouched(bc.touched_files, touched, cap);

    const atLastStep = Number(bc.tool_calls_at_last_step);
    const base = isFinite(atLastStep) && atLastStep >= 0 ? atLastStep : 0;
    const since = bc.tool_calls - base;
    const threshold = Number(cfg.step_nudge_after) || 15;
    const lastNudge = Number(bc.tool_calls_at_last_nudge);
    const sinceNudge = isFinite(lastNudge) && lastNudge >= 0 ? bc.tool_calls - lastNudge : Infinity;

    if (since >= threshold && sinceNudge >= threshold && cfg.quiet !== true) {
      const name = bc.name || bc.title || bc.id || 'the open breadcrumb';
      nudge = '[autocache] ' + since + ' tool calls since the last logged step on "'
        + store.truncate(name, 80) + '". Log a step so a resumed session knows where you are.';
      bc.tool_calls_at_last_nudge = bc.tool_calls;
    }
    store.saveBreadcrumb(bc);
  }

  store.saveArc(a);

  if (touched.length) {
    store.appendEvent({
      event: 'tool_write',
      session_id: input.session_id || '',
      tool: toolName,
      paths: touched.slice(0, 5),
      breadcrumb_id: bc && bc.id ? bc.id : null
    });
  }

  if (nudge) process.stderr.write(nudge + '\n');
} catch (e) { /* fail open */ }

process.exit(0);
