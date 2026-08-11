'use strict';
/**
 * Autocache Claude native-team event recorder.
 *
 * TaskCreated, TaskCompleted, and TeammateIdle remain controlled by Claude's
 * native task list and mailbox. This hook only writes an immutable continuity
 * receipt; it never blocks a task transition or keeps a teammate active.
 */

try {
  const store = require('./lib/store.js');
  const input = store.readStdinJSON();
  if (store.config().enabled !== false) store.recordNativeTeamEvent(input);
} catch (e) { /* fail open */ }

process.exit(0);
