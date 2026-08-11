#!/usr/bin/env node
/**
 * Native worker integration regression.
 *
 * Proves that native worker events are isolated from the lead breadcrumb,
 * stop receipts survive a fork, exact-marker reconciliation is required, and
 * parallel workers do not collide with one another. Zero dependencies.
 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');

const repoRoot = path.resolve(__dirname, '..', '..');
const hooksDir = path.join(repoRoot, 'hooks');
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'autocache-workers-'));
process.env.AUTOCACHE_HOME = home;
const store = require(path.join(hooksDir, 'lib', 'store.js'));

let assertions = 0;

function check(ok, message) {
  assertions += 1;
  if (!ok) throw new Error('FAIL: ' + message);
  console.log('ok    ' + message);
}

function runHook(file, input, surface) {
  const res = spawnSync(process.execPath, [path.join(hooksDir, file), '--surface=' + (surface || 'codex')], {
    input: JSON.stringify(input || {}),
    env: Object.assign({}, process.env, { AUTOCACHE_HOME: home }),
    cwd: hooksDir,
    encoding: 'utf8',
    timeout: 20000
  });
  check(!res.error, file + ' spawned');
  check(res.status === 0, file + ' exited 0');
  return res;
}

function filesUnder(dir, predicate) {
  const out = [];
  const walk = (current) => {
    let entries = [];
    try { entries = fs.readdirSync(current, { withFileTypes: true }); } catch (e) { return; }
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (!predicate || predicate(full)) out.push(full);
    }
  };
  walk(dir);
  return out;
}

function spawnWorkerTool(workerId) {
  return new Promise((resolve, reject) => {
    const input = JSON.stringify({
      session_id: 'parent-session',
      agent_id: workerId,
      agent_type: 'explorer',
      hook_event_name: 'PostToolUse',
      tool_name: 'Edit',
      tool_use_id: 'tool-' + workerId,
      tool_input: { file_path: 'src/' + workerId + '.js' }
    });
    const child = spawn(process.execPath, [path.join(hooksDir, 'post-tool-use.js'), '--surface=claude-code'], {
      env: Object.assign({}, process.env, { AUTOCACHE_HOME: home }),
      cwd: hooksDir,
      stdio: ['pipe', 'pipe', 'pipe']
    });
    let stderr = '';
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0) reject(new Error(workerId + ' exited ' + code + ': ' + stderr));
      else resolve();
    });
    child.stdin.end(input);
  });
}

async function main() {
  store.writeJSON('breadcrumbs/bc_lead.json', {
    version: 1,
    id: 'bc_lead',
    name: 'worker regression | targets: src/**',
    status: 'open',
    created_at: '2026-08-11T12:00:00.000Z',
    planned_steps: ['collect worker evidence', 'finish integration'],
    steps: [],
    tool_calls: 0
  });
  store.writeJSON('breadcrumbs/active.json', {
    version: 1,
    breadcrumb_id: 'bc_lead',
    updated_at: '2026-08-11T12:00:00.000Z'
  });

  runHook('post-tool-use.js', {
    session_id: 'parent-session',
    hook_event_name: 'PostToolUse',
    tool_name: 'Read',
    tool_input: { file_path: 'src/lead.js' }
  }, 'codex');
  check(store.readBreadcrumb('bc_lead').tool_calls === 1, 'main-thread tool increments lead breadcrumb before workers start');
  check(store.arc().tool_calls === 1, 'main-thread tool increments lead arc before workers start');

  const start = runHook('subagent-start.js', {
    session_id: 'parent-session',
    turn_id: 'turn-1',
    agent_id: 'worker-main',
    agent_type: 'explorer',
    hook_event_name: 'SubagentStart',
    cwd: repoRoot
  }, 'codex');
  const startOut = JSON.parse(start.stdout);
  check(startOut.hookSpecificOutput.hookEventName === 'SubagentStart', 'start injects native worker boundary');
  const starts = filesUnder(path.join(home, 'workers'), (f) => path.basename(f).startsWith('start_'));
  check(starts.length === 1, 'one immutable start receipt written');
  const startRec = JSON.parse(fs.readFileSync(starts[0], 'utf8'));
  check(startRec.chain_head_id === 'bc_lead', 'start receipt snapshots lead chain head');

  runHook('post-tool-use.js', {
    session_id: 'parent-session',
    agent_id: 'worker-main',
    agent_type: 'explorer',
    hook_event_name: 'PostToolUse',
    tool_name: 'Edit',
    tool_use_id: 'tool-child',
    tool_input: { file_path: 'src/child.js' }
  }, 'codex');
  check(store.readBreadcrumb('bc_lead').tool_calls === 1, 'tagged child tool does not increment lead breadcrumb');
  check(store.arc().tool_calls === 1, 'tagged child tool does not mutate lead arc');
  const workerEvents = fs.readFileSync(path.join(home, 'workers', 'parent-session', 'worker-main', 'events.jsonl'), 'utf8');
  check(workerEvents.includes('worker_tool') && workerEvents.includes('src/child.js'), 'child tool lands in worker-specific event stream');

  runHook('post-tool-use.js', {
    session_id: 'parent-session',
    hook_event_name: 'PostToolUse',
    tool_name: 'Edit',
    tool_use_id: 'codex-ambiguous-child',
    tool_input: { file_path: 'src/ambiguous.js' }
  }, 'codex');
  check(store.readBreadcrumb('bc_lead').tool_calls === 1, 'untagged Codex event during active worker cannot change lead breadcrumb');
  check(store.arc().tool_calls === 1, 'untagged Codex event during active worker cannot change lead arc');
  const unattributed = path.join(home, 'workers', 'parent-session', 'unattributed', 'events.jsonl');
  check(fs.existsSync(unattributed), 'untagged Codex event is quarantined');
  check(fs.readFileSync(unattributed, 'utf8').includes('src/ambiguous.js'), 'quarantine preserves ambiguous write metadata');

  const fork = store.forkBreadcrumb('bc_lead', { by: 'codex parent-session', surface: 'codex' });
  check(fork.ok, 'lead fork succeeds while worker is running');
  check(store.readBreadcrumb('bc_lead').forked_to === fork.id, 'source breadcrumb freezes to new head');

  const stop = runHook('subagent-stop.js', {
    session_id: 'parent-session',
    turn_id: 'turn-1',
    agent_id: 'worker-main',
    agent_type: 'explorer',
    hook_event_name: 'SubagentStop',
    cwd: repoRoot,
    agent_transcript_path: path.join(home, 'worker-main.jsonl'),
    last_assistant_message: 'Implemented child.js and verified its focused test.',
    stop_hook_active: false
  }, 'codex');
  const stopOut = JSON.parse(stop.stdout);
  check(typeof stopOut.systemMessage === 'string' && stopOut.systemMessage.includes('[worker:'), 'stop tells lead the exact reconciliation marker');
  const stops = filesUnder(path.join(home, 'workers'), (f) => path.basename(f).startsWith('stop_'));
  check(stops.length === 1, 'one immutable stop receipt written');
  const stopRec = JSON.parse(fs.readFileSync(stops[0], 'utf8'));
  check(stopRec.chain_head_id_at_start === 'bc_lead', 'stop receipt retains original parent head');
  check(stopRec.chain_head_id === fork.id, 'stop receipt follows current fork-chain head');
  check(store.readBreadcrumb('bc_lead').tool_calls === 1, 'stop hook does not mutate frozen ancestor');
  check(store.readBreadcrumb(fork.id).tool_calls === 0, 'stop hook does not mutate live head');
  check(store.pendingWorkerReceipts(5).some((r) => r.receipt_id === stopRec.receipt_id), 'unreconciled result is pending');

  const resume = runHook('session-start.js', {
    session_id: 'next-parent-session',
    source: 'resume',
    hook_event_name: 'SessionStart',
    cwd: repoRoot
  }, 'codex');
  const resumeOut = JSON.parse(resume.stdout);
  check(resumeOut.hookSpecificOutput.additionalContext.includes(stopRec.receipt_id), 'next session sees pending worker result');

  const head = store.readBreadcrumb(fork.id);
  head.steps.push({
    at: new Date().toISOString(),
    source: 'lead',
    text: 'Verified worker output and merged it [worker:' + stopRec.receipt_id + ']'
  });
  check(store.saveBreadcrumb(head), 'lead writes exact reconciliation marker to live head');
  check(!store.pendingWorkerReceipts(5).some((r) => r.receipt_id === stopRec.receipt_id), 'exact marker clears pending result');

  for (const event of ['TaskCreated', 'TaskCompleted', 'TeammateIdle']) {
    const payload = {
      session_id: 'parent-session',
      hook_event_name: event,
      team_name: 'native-team',
      teammate_name: 'researcher',
      task_id: 'task-1',
      task_subject: 'Inspect native hooks',
      cwd: repoRoot
    };
    runHook('native-team-event.js', payload, 'claude-code');
  }
  const teamReceipts = filesUnder(path.join(home, 'teams'), (f) => f.endsWith('.json'));
  check(teamReceipts.length === 3, 'Claude native team task and idle events are durable receipts');

  const beforeParallel = store.readBreadcrumb(fork.id).tool_calls;
  const parallelIds = Array.from({ length: 12 }, (_, i) => 'parallel-' + String(i + 1).padStart(2, '0'));
  await Promise.all(parallelIds.map(spawnWorkerTool));
  check(store.readBreadcrumb(fork.id).tool_calls === beforeParallel, 'parallel workers do not change lead breadcrumb');
  for (const id of parallelIds) {
    const eventPath = path.join(home, 'workers', 'parent-session', id, 'events.jsonl');
    check(fs.existsSync(eventPath), 'parallel worker has isolated stream: ' + id);
    check(fs.readFileSync(eventPath, 'utf8').includes('src/' + id + '.js'), 'parallel worker stream has its own write: ' + id);
  }


  const sharedId = 'parallel-shared';
  await Promise.all(Array.from({ length: 12 }, () => spawnWorkerTool(sharedId)));
  const sharedPath = path.join(home, 'workers', 'parent-session', sharedId, 'events.jsonl');
  const sharedLines = fs.readFileSync(sharedPath, 'utf8').trim().split(/\r?\n/);
  check(sharedLines.length === 12, 'same-worker parallel stream retained all 12 appends');
  check(sharedLines.every((line) => { try { JSON.parse(line); return true; } catch (e) { return false; } }),
    'same-worker parallel stream contains only complete JSON lines in this run');

  const leftovers = filesUnder(home, (f) => f.endsWith('.tmp'));
  check(leftovers.length === 0, 'no partial temp files remain');
  console.log('');
  console.log(assertions + ' worker lifecycle assertion(s) passed');
}

main().then(() => {
  fs.rmSync(home, { recursive: true, force: true });
}).catch((err) => {
  console.error(err && err.stack ? err.stack : err);
  console.error('sandbox kept for inspection: ' + home);
  process.exitCode = 1;
});
