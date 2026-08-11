'use strict';
/**
 * Autocache SubagentStop hook.
 *
 * Persists the native worker's final result as an immutable local receipt.
 * It never blocks, continues, or mutates the parent's breadcrumb.
 */

try {
  const store = require('./lib/store.js');
  const input = store.readStdinJSON();
  if (store.config().enabled === false) process.exit(0);

  const rec = store.recordWorkerStop(input);
  if (!rec || store.config().quiet === true) process.exit(0);

  process.stdout.write(JSON.stringify({
    systemMessage: '[autocache] Native worker ' + (rec.worker_type || rec.worker_id)
      + ' result saved as ' + rec.receipt_id
      + '. Lead: verify the result, then log one breadcrumb milestone containing '
      + '[worker:' + rec.receipt_id + '] to reconcile it. The worker did not alter the fork-chain head.'
  }));
} catch (e) { /* fail open */ }

process.exit(0);
