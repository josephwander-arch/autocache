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

  // ---- arc counters -------------------------------------------------------
  const a = store.arc();
  a.tool_calls = (Number(a.tool_calls) || 0) + 1;
  if (typeof input.session_id === 'string' && input.session_id) a.session_id = input.session_id;
  if (typeof input.cwd === 'string' && input.cwd) a.cwd = input.cwd;
  if (touched.length) a.touched_files = store.mergeTouched(a.touched_files, touched, cap);

  // ---- breadcrumb ---------------------------------------------------------
  const bc = store.activeBreadcrumb();
  let nudge = '';
  if (bc) {
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
