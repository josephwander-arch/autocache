import fs from 'node:fs';
import path from 'node:path';
import {
  actor,
  gitSnapshot,
  runBreadcrumbCli,
  scope,
  store,
  workspace
} from './runtime.js';
import { cleanList, cleanText } from './results.js';

const nowIso = () => new Date().toISOString();

// Corruption contract (see test/corrupt-store.test.js for the per-operation
// decisions): a state file that EXISTS but cannot be parsed is corruption,
// never absence. store.readJSON deliberately fails open for the lifecycle
// hooks, so the bridge probes with a sentinel to tell the two apart. Reads
// surface corruption explicitly; mutations that could overwrite the damaged
// record fail closed. Absent files remain ordinary empty-store state.
const CORRUPT_SENTINEL = { __autocache_corrupt_probe: true };

function stateProblem(relPath) {
  try {
    if (!fs.existsSync(store.resolvePath(relPath))) return null;
  } catch {
    return null;
  }
  if (store.readJSON(relPath, CORRUPT_SENTINEL) === CORRUPT_SENTINEL) {
    return `${relPath} exists but is not valid JSON; repair or remove it`;
  }
  return null;
}

function guardBreadcrumbMutation() {
  const problem = stateProblem('breadcrumbs/active.json');
  if (problem) {
    throw new Error(`${problem} - breadcrumb mutations fail closed rather than overwrite it; no write was made`);
  }
}

function isOpenReminder(reminder) {
  if (!reminder || typeof reminder !== 'object') return false;
  if (reminder.completed === true || reminder.done === true) return false;
  return !/^(done|complete|completed|cancel|cancelled|canceled)$/i.test(
    String(reminder.status || '')
  );
}

function reminderDocument({ strict = false } = {}) {
  const file = store.resolvePath('reminders.json');
  const exists = fs.existsSync(file);
  const raw = store.readJSON('reminders.json', null);
  if (exists && (raw === null || typeof raw !== 'object')) {
    if (strict) throw new Error('reminders.json exists but is not valid JSON; no write was made');
    return { reminders: [], corrupted: true };
  }
  if (Array.isArray(raw)) return { reminders: raw, migrated_from_array: true };
  if (raw && Array.isArray(raw.reminders)) return raw;
  if (exists && strict) {
    throw new Error('reminders.json has an unsupported shape; no write was made');
  }
  return { reminders: [], updated_at: null };
}

function dueOrUndatedReminders() {
  const now = Date.now();
  return reminderDocument().reminders
    .filter((reminder) => {
      if (!isOpenReminder(reminder)) return false;
      if (!reminder.due_at) return true;
      const due = Date.parse(reminder.due_at);
      return Number.isFinite(due) && due <= now;
    })
    .sort((left, right) => {
      const leftDue = Date.parse(left.due_at || '') || 0;
      const rightDue = Date.parse(right.due_at || '') || 0;
      return leftDue - rightDue;
    })
    .slice(0, 50)
    .map((reminder) => ({
      id: cleanText(reminder.id, 120),
      text: cleanText(reminder.text || reminder.title || reminder.message, 1000),
      due_at: reminder.due_at || null,
      recurring: !!reminder.recurring
    }));
}

function countJsonFiles(relativeDirectory, cap = 10_000) {
  try {
    return fs.readdirSync(store.resolvePath(relativeDirectory), { withFileTypes: true })
      .slice(0, cap)
      .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
      .length;
  } catch {
    return 0;
  }
}

function latestJson(relativeDirectory) {
  try {
    const directory = store.resolvePath(relativeDirectory);
    const entries = fs.readdirSync(directory, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
      .slice(0, 500)
      .map((entry) => {
        const full = path.join(directory, entry.name);
        let modified = 0;
        try { modified = fs.statSync(full).mtimeMs; } catch { /* ignore */ }
        return { name: entry.name, modified };
      })
      .sort((a, b) => b.modified - a.modified);
    if (!entries.length) return { record: null, problem: null };
    const relative = `${relativeDirectory}/${entries[0].name}`;
    const record = store.readJSON(relative, CORRUPT_SENTINEL);
    if (record === CORRUPT_SENTINEL) {
      // Distinguish "no checkpoint" from "the newest checkpoint is damaged" -
      // silently reporting null here is the defaults-instead-of-surfacing
      // failure the corruption contract forbids.
      return { record: null, problem: `${relative} exists but is not valid JSON; repair or remove it` };
    }
    return { record, problem: null };
  } catch {
    return { record: null, problem: null };
  }
}

function renderBreadcrumb(breadcrumb) {
  if (!breadcrumb) return null;
  const progress = store.breadcrumbProgress(breadcrumb);
  return {
    id: breadcrumb.id || null,
    status: breadcrumb.status || 'open',
    name: breadcrumb.name || breadcrumb.title || '',
    targets: cleanList(breadcrumb.targets, 50, 1000),
    completed: cleanList(progress.completed, 50, 1000),
    remaining: cleanList(progress.remaining, 50, 1000),
    forked_from: breadcrumb.forked_from || null,
    forked_to: breadcrumb.forked_to || null,
    updated_at: breadcrumb.updated_at || null
  };
}

function sessionSummary(session) {
  if (!session) return null;
  const summary = session.summary && typeof session.summary === 'object' ? session.summary : {};
  return {
    id: session.id || session.session_id || null,
    title: cleanText(session.title || session.name || '', 300),
    started_at: session.started_at || session.created_at || null,
    ended_at: session.ended_at || session.completed_at || null,
    done: cleanList(summary.done || session.done, 20, 1000),
    remaining: cleanList(summary.remaining || session.remaining, 20, 1000),
    risks: cleanList(summary.risks || session.risks, 20, 1000),
    next_action: cleanText(summary.next_action || session.next_action || '', 1000) || null
  };
}

function activeBreadcrumbId() {
  const active = store.activeBreadcrumb();
  return active ? active.id || null : null;
}

function currentSessionId() {
  const index = store.sessionIndex();
  return index.length ? index[0].id || null : null;
}

export const actions = {
  status() {
    const initialized = fs.existsSync(store.home());
    const reminderState = reminderDocument();
    const reminders = reminderState.reminders;
    const pending = reminders.filter(isOpenReminder);
    const due = dueOrUndatedReminders();
    return {
      ok: true,
      initialized,
      state_root: store.home(),
      scope,
      automatic_lifecycle_capture: false,
      active_breadcrumb: renderBreadcrumb(store.activeBreadcrumb()),
      counts: {
        breadcrumbs: countJsonFiles('breadcrumbs') - (fs.existsSync(store.resolvePath('breadcrumbs/active.json')) ? 1 : 0),
        checkpoints: countJsonFiles('checkpoints'),
        sessions: store.sessionIndex().length,
        reminders_pending: pending.length,
        reminders_due: due.length
      },
      problems: [
        ...(reminderState.corrupted
          ? ['reminders.json is invalid; reminder writes will fail closed until it is repaired']
          : []),
        ...[stateProblem('breadcrumbs/active.json')].filter(Boolean)
      ]
    };
  },

  resume() {
    const { record: checkpoint, problem: checkpointProblem } = latestJson('checkpoints');
    const problems = [
      stateProblem('breadcrumbs/active.json'),
      checkpointProblem
    ].filter(Boolean);
    return {
      ok: true,
      scope,
      automatic_lifecycle_capture: false,
      problems,
      last_session: sessionSummary(store.lastSession()),
      active_breadcrumb: renderBreadcrumb(store.activeBreadcrumb()),
      latest_checkpoint: checkpoint ? {
        id: checkpoint.id || null,
        label: cleanText(checkpoint.label || '', 200),
        summary: cleanText(checkpoint.summary || '', 1000),
        done: cleanList(checkpoint.done, 20, 1000),
        remaining: cleanList(checkpoint.remaining, 20, 1000),
        risks: cleanList(checkpoint.risks, 20, 1000),
        next_action: cleanText(checkpoint.next_action || '', 1000) || null,
        files_touched: cleanList(checkpoint.files_touched, 30, 1000),
        created_at: checkpoint.created_at || null
      } : null,
      reminders_due: dueOrUndatedReminders()
    };
  },

  breadcrumbStart({ name, targets = [], planned_steps: plannedSteps = [] }) {
    guardBreadcrumbMutation();
    return {
      ok: true,
      breadcrumb: runBreadcrumbCli('start', {
        name: cleanText(name, 500),
        targets: cleanList(targets, 30, 1000),
        plannedSteps: cleanList(plannedSteps, 50, 1000)
      })
    };
  },

  breadcrumbStep({ milestone }) {
    guardBreadcrumbMutation();
    return {
      ok: true,
      breadcrumb: runBreadcrumbCli('step', { text: cleanText(milestone, 2000) })
    };
  },

  breadcrumbComplete({ outcome }) {
    guardBreadcrumbMutation();
    return {
      ok: true,
      breadcrumb: runBreadcrumbCli('complete', { text: cleanText(outcome, 2000) })
    };
  },

  breadcrumbAbort({ reason }) {
    guardBreadcrumbMutation();
    return {
      ok: true,
      breadcrumb: runBreadcrumbCli('abort', { text: cleanText(reason, 2000) })
    };
  },

  checkpoint(input) {
    const createdAt = nowIso();
    const id = store.shortId('ckpt');
    const packet = {
      id,
      created_at: createdAt,
      label: cleanText(input.label, 200),
      summary: cleanText(input.summary, 2000),
      done: cleanList(input.done, 40, 1500),
      remaining: cleanList(input.remaining, 40, 1500),
      risks: cleanList(input.risks, 40, 1500),
      next_action: cleanText(input.next_action, 1500),
      files_touched: cleanList(input.files_touched, 50, 1500),
      cwd: workspace,
      surface: actor,
      session_id: currentSessionId(),
      breadcrumb_id: activeBreadcrumbId(),
      git: gitSnapshot()
    };
    if (!store.writeJSON(`checkpoints/${store.safeName(id)}.json`, packet)) {
      throw new Error('checkpoint could not be written');
    }
    store.appendEvent({
      event: 'checkpoint.save',
      surface: actor,
      data: { id, label: packet.label }
    });
    // The write proceeds even when unrelated state is damaged - a checkpoint
    // is a recovery tool - but what could not be embedded is surfaced, never
    // silently recorded as absent.
    const problems = [stateProblem('breadcrumbs/active.json')].filter(Boolean)
      .map((problem) => `${problem} - breadcrumb_id was recorded as null`);
    return {
      ok: true,
      checkpoint: packet,
      path: store.resolvePath(`checkpoints/${id}.json`),
      ...(problems.length ? { problems } : {})
    };
  },

  handoff(input) {
    const writtenAt = nowIso();
    const id = store.shortId('handoff');
    const sessionId = currentSessionId();
    const packet = {
      id,
      written_at: writtenAt,
      from: actor,
      to: cleanText(input.to, 120) || null,
      title: cleanText(input.title, 300),
      done: cleanList(input.done, 40, 1500),
      remaining: cleanList(input.remaining, 40, 1500),
      risks: cleanList(input.risks, 40, 1500),
      next_action: cleanText(input.next_action, 1500),
      context: cleanList(input.context, 40, 1500),
      files_touched: cleanList(input.files_touched, 50, 1500),
      open_questions: cleanList(input.open_questions, 25, 1500),
      session_id: sessionId,
      breadcrumb_id: activeBreadcrumbId(),
      cwd: workspace,
      git: gitSnapshot(),
      delivery: 'local-state-only'
    };
    const relativePath = `handoffs/${store.safeName(id)}.json`;
    if (!store.writeJSON(relativePath, packet)) throw new Error('handoff packet could not be written');

    let sessionUpdated = false;
    const problems = [];
    if (sessionId) {
      const session = store.sessionRecord(sessionId);
      if (session) {
        session.handoff = packet;
        session.summary = {
          ...(session.summary && typeof session.summary === 'object' ? session.summary : {}),
          done: packet.done,
          remaining: packet.remaining,
          risks: packet.risks,
          next_action: packet.next_action
        };
        session.updated_at = writtenAt;
        sessionUpdated = store.writeJSON(`sessions/${store.safeName(sessionId)}.json`, session);
      } else {
        // sessionRecord fails open to null; if the file is actually present
        // but damaged, say so instead of a bare session_updated: false.
        const problem = stateProblem(`sessions/${store.safeName(sessionId)}.json`);
        if (problem) problems.push(`${problem} - the session record was not updated`);
      }
    }
    store.appendEvent({
      event: 'handoff.write',
      surface: actor,
      data: { id, session_id: sessionId, to: packet.to, delivery: packet.delivery }
    });
    return {
      ok: true,
      handoff: packet,
      path: store.resolvePath(relativePath),
      session_updated: sessionUpdated,
      ...(problems.length ? { problems } : {}),
      note: 'Saved locally only; no message was sent and ownership was not transferred.'
    };
  },

  remindersList({ include_completed: includeCompleted = false, limit = 50 }) {
    const document = reminderDocument();
    const safeLimit = Math.max(1, Math.min(Number(limit) || 50, 100));
    const reminders = document.reminders
      .filter((reminder) => includeCompleted || isOpenReminder(reminder))
      .sort((a, b) => {
        const left = Date.parse(a.due_at || '') || Number.MAX_SAFE_INTEGER;
        const right = Date.parse(b.due_at || '') || Number.MAX_SAFE_INTEGER;
        return left - right;
      })
      .slice(0, safeLimit)
      .map((reminder) => ({
        id: cleanText(reminder.id, 120),
        text: cleanText(reminder.text || reminder.title || reminder.message, 1000),
        due_at: reminder.due_at || null,
        status: reminder.status || (isOpenReminder(reminder) ? 'pending' : 'done'),
        recurring: reminder.recurring || null,
        tags: cleanList(reminder.tags, 20, 100)
      }));
    return {
      ok: true,
      scope,
      reminders,
      returned: reminders.length,
      total_records: document.reminders.length,
      corrupted: document.corrupted === true
    };
  },

  remindersAdd(input) {
    const document = reminderDocument({ strict: true });
    if (document.reminders.length >= 5000) {
      throw new Error('reminder store reached the 5000-record safety limit; no write was made');
    }
    const createdAt = nowIso();
    let dueAt = null;
    if (input.due_at) {
      const parsed = Date.parse(input.due_at);
      if (!Number.isFinite(parsed)) throw new Error('due_at must be a valid ISO-8601 timestamp');
      dueAt = new Date(parsed).toISOString();
    }
    const recurringEvery = cleanText(input.recurring_every, 20);
    if (recurringEvery && !/^\d+[smhdw]$/.test(recurringEvery)) {
      throw new Error('recurring_every must look like 30m, 1h, 1d, or 1w');
    }
    const reminder = {
      id: store.shortId('rem'),
      text: cleanText(input.text, 1000),
      created_at: createdAt,
      due_at: dueAt,
      recurring: recurringEvery ? { every: recurringEvery } : null,
      tags: cleanList(input.tags, 20, 100),
      status: 'pending',
      completed_at: null,
      surface: actor
    };
    document.reminders.push(reminder);
    document.updated_at = createdAt;
    delete document.migrated_from_array;
    if (!store.writeJSON('reminders.json', document)) throw new Error('reminder could not be written');
    store.appendEvent({
      event: 'reminder.add',
      surface: actor,
      data: { id: reminder.id, due_at: reminder.due_at }
    });
    return { ok: true, reminder };
  }
};
