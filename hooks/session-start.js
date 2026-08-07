'use strict';
/**
 * Autocache SessionStart hook.
 *
 * Restores the work arc: last session summary, the open breadcrumb with its
 * completed and remaining steps, due reminders, and self-state.
 *
 * Emits, on stdout:
 *   {"hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":"..."}}
 *
 * Nothing to restore means nothing printed. An empty banner is noise, and noise
 * trains the user to ignore the hook.
 *
 * Fails open: any error exits 0 silently.
 */

try {
  const store = require('./lib/store.js');
  const input = store.readStdinJSON();
  const cfg = store.config();

  if (cfg.enabled === false) process.exit(0);

  const lines = [];

  // ---- last session -------------------------------------------------------
  const last = store.lastSession();
  if (last) {
    const when = String(last.ended_at || last.updated_at || last.started_at || '').slice(0, 16).replace('T', ' ');
    const label = last.title ? store.truncate(last.title, 80) : '';
    const summary = last.summary || last.handoff || last.notes || '';
    const head = ['Last session', last.id ? '(' + last.id + ')' : '', when ? when : '']
      .filter(Boolean).join(' ');
    if (summary) {
      lines.push(head + ': ' + store.truncate(summary, 400));
    } else if (label) {
      lines.push(head + ': ' + label);
    }
    const nextSteps = Array.isArray(last.next_steps) ? last.next_steps : [];
    if (nextSteps.length) {
      lines.push('  next steps: ' + nextSteps.slice(0, 5).map((s) => store.truncate(s, 90)).join(' | '));
    }
  }

  // ---- open breadcrumb ----------------------------------------------------
  const bc = store.activeBreadcrumb();
  if (bc) {
    const name = bc.name || bc.title || bc.id || 'unnamed';
    const started = String(bc.created_at || bc.started_at || '').slice(0, 16).replace('T', ' ');
    lines.push('Open breadcrumb: ' + store.truncate(name, 140)
      + (bc.id ? ' [' + bc.id + ']' : '')
      + (started ? ' started ' + started : ''));

    const prog = store.breadcrumbProgress(bc);
    if (prog.completed.length) {
      lines.push('  done (' + prog.completed.length + '): '
        + prog.completed.slice(-6).map((s) => store.truncate(s, 90)).join(' | '));
    }
    if (prog.remaining.length) {
      lines.push('  remaining (' + prog.remaining.length + '): '
        + prog.remaining.slice(0, 6).map((s) => store.truncate(s, 90)).join(' | '));
    }
    if (Array.isArray(bc.touched_files) && bc.touched_files.length) {
      lines.push('  files: ' + bc.touched_files.slice(0, 8).join(', '));
    }

    // ---- fork chain: a frozen record means the work moved -----------------
    if (store.isFrozen(bc)) {
      const notice = store.frozenNotice(bc);
      if (notice) lines.push('  FROZEN: ' + store.truncate(notice, 300));
    }

    // ---- decisions still awaiting resolution ------------------------------
    const decs = store.openDecisions(bc);
    if (decs.length) {
      const blocked = store.blockedStepIndexes(bc);
      lines.push('  awaiting decision (' + decs.length
        + (blocked.size ? ', blocking ' + blocked.size + ' pending step(s)' : '') + '): '
        + decs.slice(0, 3).map((d) => store.truncate(d.question || d.id || 'unnamed', 90)
          + ' [waits on ' + (d.waits_on || 'user') + ']').join(' | '));
    }
  } else {
    // No open breadcrumb, but the pointer may still name a record another
    // session finished or aborted through the fork chain. Surface the
    // pointer rather than leaving a dangling operation; an incomplete chain
    // keeps surfacing until it is completed or explicitly retired.
    const ptr = store.readJSON('breadcrumbs/active.json', null);
    const ptrId = ptr && typeof ptr === 'object' && !Array.isArray(ptr)
      ? (typeof ptr.breadcrumb_id === 'string' ? ptr.breadcrumb_id
        : (typeof ptr.id === 'string' ? ptr.id : null))
      : null;
    if (ptrId) {
      const rec = store.readBreadcrumb(ptrId);
      if (rec && rec.completed_via) {
        lines.push('Breadcrumb ' + rec.id + ' was finished elsewhere - completed via '
          + rec.completed_via + '. Nothing to resume on it.');
      } else if (rec && !store.isOpen(rec) && rec.retired !== true
        && (rec.forked_from || rec.forked_to)
        && typeof rec.status === 'string' && /^aborted$/i.test(rec.status)) {
        lines.push('Chain tail ' + rec.id + ' was aborted'
          + (rec.outcome ? ': ' + store.truncate(rec.outcome, 120) : '')
          + '. The chain is still incomplete - adopt it with /breadcrumb adopt '
          + rec.id + ' or retire it with a recorded reason.');
      }
    }
  }

  // ---- last auto-checkpoint (the Stop-hook arc) ---------------------------
  const a = store.arc();
  if (a && a.last_checkpoint) {
    const cp = store.readJSON('checkpoints/' + store.safeName(a.last_checkpoint) + '.json', null);
    if (cp && typeof cp === 'object') {
      const when = String(cp.created_at || '').slice(0, 16).replace('T', ' ');
      const files = Array.isArray(cp.touched_files) ? cp.touched_files : [];
      const bits = [];
      if (typeof cp.tool_calls === 'number' && cp.tool_calls > 0) bits.push(cp.tool_calls + ' tool calls');
      if (cp.cwd) bits.push('cwd ' + cp.cwd);
      // Only surface checkpoint files when no breadcrumb already listed them.
      if (files.length && !bc) bits.push('files: ' + files.slice(0, 8).join(', '));
      if (bits.length || when) {
        lines.push('Last checkpoint' + (when ? ' ' + when : '') + (bits.length ? ' - ' + bits.join('; ') : ''));
      }
    }
  }

  // ---- due reminders ------------------------------------------------------
  const due = store.dueReminders(Date.now());
  if (due.length) {
    lines.push('Due reminders (' + due.length + '):');
    for (const r of due.slice(0, 5)) {
      lines.push('  - ' + store.truncate(r.text, 140) + ' (due ' + r.due_at.slice(0, 16).replace('T', ' ') + ')');
    }
    if (due.length > 5) lines.push('  - ... and ' + (due.length - 5) + ' more');
  }

  // ---- self-state ---------------------------------------------------------
  const self = store.selfState();
  const selfKeys = Object.keys(self);
  if (selfKeys.length) {
    const notes = self.notes || self.note || self.summary || '';
    if (notes) {
      lines.push('Self-state: ' + store.truncate(notes, 300));
    } else {
      const pairs = selfKeys.slice(0, 6)
        .map((k) => k + '=' + store.truncate(typeof self[k] === 'object' ? JSON.stringify(self[k]) : self[k], 60));
      lines.push('Self-state: ' + pairs.join(', '));
    }
  }

  // ---- bag ----------------------------------------------------------------
  const tags = store.bag();
  const tagKeys = Object.keys(tags);
  if (tagKeys.length) {
    const pairs = tagKeys.slice(0, 8)
      .map((k) => k + '=' + store.truncate(typeof tags[k] === 'object' ? JSON.stringify(tags[k]) : tags[k], 50));
    lines.push('Bag: ' + pairs.join(', '));
  }

  // ---- record the new arc, regardless of whether we print -----------------
  try {
    const next = store.arc();
    next.session_id = typeof input.session_id === 'string' ? input.session_id : next.session_id;
    next.cwd = typeof input.cwd === 'string' ? input.cwd : next.cwd;
    next.tool_calls = 0;
    next.last_breadcrumb_nudge_at = -1;
    next.warned_paths = [];
    next.breadcrumb_id = bc && bc.id ? bc.id : '';
    next.resumed_at = new Date().toISOString();
    store.saveArc(next);
  } catch (e) { /* bookkeeping is best effort */ }

  store.appendEvent({
    event: 'session_start',
    session_id: input.session_id || '',
    source: input.source || '',
    restored: lines.length > 0,
    breadcrumb_id: bc && bc.id ? bc.id : null,
    due_reminders: due.length
  });

  if (!lines.length || cfg.quiet === true) process.exit(0);

  const context = 'Autocache restored context (state: ' + store.home() + ')\n' + lines.join('\n');
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'SessionStart',
      additionalContext: context
    }
  }));
  process.exit(0);
} catch (e) {
  process.exit(0);
}
