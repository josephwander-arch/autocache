'use strict';
/**
 * Autocache SubagentStart hook.
 *
 * Records an immutable native-worker start receipt and tells the child where
 * its ownership boundary is. Native Codex/Claude machinery still owns spawn,
 * steering, waiting, cancellation, permissions, and worktree behavior.
 */

try {
  const store = require('./lib/store.js');
  const input = store.readStdinJSON();
  if (store.config().enabled === false) process.exit(0);

  const rec = store.recordWorkerStart(input);
  if (!rec || store.config().quiet === true) process.exit(0);

  const context = [
    'Autocache native-worker boundary:',
    '- Complete only the bounded task assigned by the parent using this runtime\'s native worker tools.',
    '- Do not adopt, fork, step, complete, abort, or repoint the parent breadcrumb or breadcrumbs/active.json.',
    '- Return: outcome, exact files changed, decisive validation, blockers, and remaining work.',
    '- The parent remains the only writer that reconciles your result into the durable fork-chain head.',
    'Worker receipt: ' + rec.receipt_id
      + (rec.chain_head_id ? '; parent chain head: ' + rec.chain_head_id : '; no parent breadcrumb was open')
  ].join('\n');

  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'SubagentStart',
      additionalContext: context
    }
  }));
} catch (e) { /* fail open */ }

process.exit(0);
