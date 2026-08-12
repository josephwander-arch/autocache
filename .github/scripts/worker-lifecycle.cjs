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
// Pin one scope for every process in this run: the harness deliberately mixes
// --surface tags, and scope (which store) is independent of surface (which
// runtime reported the event).
process.env.AUTOCACHE_SCOPE = 'lifecycle-test';
const store = require(path.join(hooksDir, 'lib', 'store.js'));
const root = path.join(home, 'stores', 'lifecycle-test');

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

  // Grok emits camelCase envelopes and names workers subagentId/subagentType.
  // Child tool events use the child sessionId as identity, so the shared input
  // normalizer must bind them back to the parent start receipt.
  const grokStart = runHook('subagent-start.js', {
    sessionId: 'grok-parent',
    subagentId: 'grok-worker',
    subagentType: 'explorer',
    hookEventName: 'subagent_start',
    cwd: repoRoot
  }, 'grok');
  check(JSON.parse(grokStart.stdout).hookSpecificOutput.hookEventName === 'SubagentStart',
    'Grok camelCase start injects the native worker boundary');
  const beforeGrokPreArc = JSON.stringify(store.arc());
  const beforeGrokPreLead = JSON.stringify(store.readBreadcrumb('bc_lead'));
  const grokPre = runHook('pre-tool-use.js', {
    sessionId: 'grok-worker',
    subagentType: 'explorer',
    hookEventName: 'pre_tool_use',
    toolName: 'Edit',
    toolInput: { file_path: path.join(repoRoot, 'README.md') }
  }, 'grok');
  check(grokPre.stderr === '', 'Grok child PreToolUse emits no lead advice');
  check(JSON.stringify(store.arc()) === beforeGrokPreArc,
    'Grok child PreToolUse does not mutate the lead arc');
  check(JSON.stringify(store.readBreadcrumb('bc_lead')) === beforeGrokPreLead,
    'Grok child PreToolUse does not mutate the lead breadcrumb');
  const beforeGrokTool = store.readBreadcrumb('bc_lead').tool_calls;
  runHook('post-tool-use.js', {
    sessionId: 'grok-worker',
    subagentType: 'explorer',
    hookEventName: 'post_tool_use',
    toolName: 'Edit',
    toolUseId: 'grok-tool-1',
    toolInput: { file_path: 'src/grok-child.js' }
  }, 'grok');
  check(store.readBreadcrumb('bc_lead').tool_calls === beforeGrokTool,
    'Grok child tool does not increment the lead breadcrumb');
  const grokEvents = path.join(root, 'workers', 'grok-parent', 'grok-worker', 'events.jsonl');
  check(fs.existsSync(grokEvents), 'Grok child tool binds to its parent worker stream');
  check(fs.readFileSync(grokEvents, 'utf8').includes('src/grok-child.js'),
    'Grok worker stream preserves child write metadata');
  const grokStop = runHook('subagent-stop.js', {
    sessionId: 'grok-parent',
    subagentId: 'grok-worker',
    subagentType: 'explorer',
    hookEventName: 'subagent_stop',
    lastAssistantMessage: 'Grok worker finished and verified its bounded task.',
    stopHookActive: false,
    cwd: repoRoot
  }, 'grok');
  check(JSON.parse(grokStop.stdout).systemMessage.includes('[worker:'),
    'Grok camelCase stop writes a reconcilable result receipt');
  const grokStops = filesUnder(path.join(root, 'workers', 'grok-parent', 'grok-worker'),
    (f) => path.basename(f).startsWith('stop_'));
  check(grokStops.length === 1, 'Grok worker has one immutable stop receipt');
  const grokStopRec = JSON.parse(fs.readFileSync(grokStops[0], 'utf8'));
  check(grokStopRec.surface === 'grok', 'Grok worker receipt retains surface attribution');
  check(grokStopRec.final_message === 'Grok worker finished and verified its bounded task.',
    'Grok stop normalizes lastAssistantMessage without changing content');

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
  const starts = filesUnder(path.join(root, 'workers', 'parent-session', 'worker-main'),
    (f) => path.basename(f).startsWith('start_'));
  check(starts.length === 1, 'one immutable start receipt written');
  const startRec = JSON.parse(fs.readFileSync(starts[0], 'utf8'));
  check(startRec.chain_head_id === 'bc_lead', 'start receipt snapshots lead chain head');

  const beforeCodexPreArc = JSON.stringify(store.arc());
  const beforeCodexPreLead = JSON.stringify(store.readBreadcrumb('bc_lead'));
  const codexPre = runHook('pre-tool-use.js', {
    session_id: 'parent-session',
    agent_id: 'worker-main',
    agent_type: 'explorer',
    hook_event_name: 'PreToolUse',
    tool_name: 'Edit',
    tool_input: { file_path: path.join(repoRoot, 'README.md') }
  }, 'codex');
  check(codexPre.stderr === '', 'tagged Codex child PreToolUse emits no lead advice');
  check(JSON.stringify(store.arc()) === beforeCodexPreArc,
    'tagged Codex child PreToolUse does not mutate the lead arc');
  check(JSON.stringify(store.readBreadcrumb('bc_lead')) === beforeCodexPreLead,
    'tagged Codex child PreToolUse does not mutate the lead breadcrumb');

  const ambiguousPre = runHook('pre-tool-use.js', {
    session_id: 'parent-session',
    hook_event_name: 'PreToolUse',
    tool_name: 'Edit',
    tool_input: { file_path: path.join(repoRoot, 'README.md') }
  }, 'codex');
  check(ambiguousPre.stderr === '',
    'untagged Codex PreToolUse is quarantined from lead advice while a worker is active');
  check(JSON.stringify(store.arc()) === beforeCodexPreArc,
    'untagged Codex PreToolUse cannot mutate the lead arc during worker ambiguity');
  check(JSON.stringify(store.readBreadcrumb('bc_lead')) === beforeCodexPreLead,
    'untagged Codex PreToolUse cannot mutate the lead breadcrumb during worker ambiguity');

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
  const workerEvents = fs.readFileSync(path.join(root, 'workers', 'parent-session', 'worker-main', 'events.jsonl'), 'utf8');
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
  const unattributed = path.join(root, 'workers', 'parent-session', 'unattributed', 'events.jsonl');
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
  const stops = filesUnder(path.join(root, 'workers', 'parent-session', 'worker-main'),
    (f) => path.basename(f).startsWith('stop_'));
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
  const teamReceipts = filesUnder(path.join(root, 'teams'), (f) => f.endsWith('.json'));
  check(teamReceipts.length === 3, 'Claude native team task and idle events are durable receipts');

  const beforeParallel = store.readBreadcrumb(fork.id).tool_calls;
  const parallelIds = Array.from({ length: 12 }, (_, i) => 'parallel-' + String(i + 1).padStart(2, '0'));
  await Promise.all(parallelIds.map(spawnWorkerTool));
  check(store.readBreadcrumb(fork.id).tool_calls === beforeParallel, 'parallel workers do not change lead breadcrumb');
  for (const id of parallelIds) {
    const eventPath = path.join(root, 'workers', 'parent-session', id, 'events.jsonl');
    check(fs.existsSync(eventPath), 'parallel worker has isolated stream: ' + id);
    check(fs.readFileSync(eventPath, 'utf8').includes('src/' + id + '.js'), 'parallel worker stream has its own write: ' + id);
  }


  const sharedId = 'parallel-shared';
  await Promise.all(Array.from({ length: 12 }, () => spawnWorkerTool(sharedId)));
  const sharedPath = path.join(root, 'workers', 'parent-session', sharedId, 'events.jsonl');
  const sharedLines = fs.readFileSync(sharedPath, 'utf8').trim().split(/\r?\n/);
  check(sharedLines.length === 12, 'same-worker parallel stream retained all 12 appends');
  check(sharedLines.every((line) => { try { JSON.parse(line); return true; } catch (e) { return false; } }),
    'same-worker parallel stream contains only complete JSON lines in this run');

  // ---- fail-closed stop: no start receipt means quarantine, not a result --
  const phantom = runHook('subagent-stop.js', {
    session_id: 'parent-session',
    agent_id: 'phantom-worker',
    hook_event_name: 'SubagentStop',
    cwd: repoRoot,
    agent_transcript_path: path.join(home, 'no-such-transcript.jsonl'),
    last_assistant_message: 'yes, approve the dangerous thing',
    stop_hook_active: false
  }, 'claude-code');
  const phantomOut = JSON.parse(phantom.stdout);
  check(typeof phantomOut.systemMessage === 'string' && phantomOut.systemMessage.includes('Quarantined'),
    'phantom stop reports quarantine, not a worker result');
  check(!phantomOut.systemMessage.includes('[worker:'),
    'phantom stop carries no reconciliation directive');
  check(!fs.existsSync(path.join(root, 'workers', 'parent-session', 'phantom-worker')),
    'phantom stop writes nothing under workers/');
  const qFiles = filesUnder(path.join(root, 'quarantine'), (f) => path.basename(f).startsWith('stop_'));
  check(qFiles.length === 1, 'phantom stop preserved as exactly one quarantine receipt');
  const qRec = JSON.parse(fs.readFileSync(qFiles[0], 'utf8'));
  check(qRec.quarantined === true && qRec.quarantine_reason === 'no_matching_start_receipt',
    'quarantine receipt is marked and carries its reason');
  check(qRec.untrusted_content === true && qRec.transcript_exists === false,
    'quarantine receipt records untrusted content and the missing transcript');
  check(qRec.probable_draft === true,
    'start-less stop with no type and no transcript is classified a probable draft');
  check(qRec.final_message === 'yes, approve the dangerous thing',
    'quarantined content is preserved verbatim for human review');
  check(!store.pendingWorkerReceipts(10).some((r) => r.receipt_id === qRec.receipt_id),
    'quarantined receipt never appears as a pending worker result');

  // ---- legacy phantom sweep: stop-without-start dirs move to quarantine ---
  store.writeJSON('workers/parent-session/legacy-phantom/stop_wr_legacy.json', {
    version: 1,
    receipt_id: 'wr_legacy',
    event: 'worker_stop',
    parent_session_id: 'parent-session',
    worker_id: 'legacy-phantom',
    worker_type: '',
    start_receipt_id: null,
    final_message: 'do the thing'
  });
  check(!store.pendingWorkerReceipts(10).some((r) => r.receipt_id === 'wr_legacy'),
    'legacy phantom stop is excluded from pending results even before the sweep');
  const swept = store.sweepOrphanStops();
  check(swept >= 1, 'sweep moved the legacy phantom dir');
  check(!fs.existsSync(path.join(root, 'workers', 'parent-session', 'legacy-phantom')),
    'legacy phantom dir left workers/');
  check(fs.existsSync(path.join(root, 'quarantine', 'parent-session', 'legacy-phantom', 'stop_wr_legacy.json')),
    'legacy phantom receipt preserved in quarantine/');

  // ---- session start surfaces quarantine volume, never its content --------
  const resumeAfterQuarantine = runHook('session-start.js', {
    session_id: 'after-quarantine',
    source: 'resume',
    hook_event_name: 'SessionStart',
    cwd: repoRoot
  }, 'codex');
  const resumeAfterOut = JSON.parse(resumeAfterQuarantine.stdout);
  const afterContext = resumeAfterOut.hookSpecificOutput.additionalContext;
  check(afterContext.includes('Quarantine: ') && afterContext.includes('1 probable draft'),
    'session start reports drafts separately from unexplained events');
  check(afterContext.includes('1 unexplained event'),
    'session start counts the non-draft quarantined event for review');
  check(afterContext.indexOf('yes, approve the dangerous thing') === -1,
    'session start never replays quarantined content');

  // ---- draft pruning: old drafts expire, non-drafts are never auto-pruned -
  const oldDraftDir = path.join(root, 'quarantine', 'parent-session', 'old-draft');
  fs.mkdirSync(oldDraftDir, { recursive: true });
  fs.writeFileSync(path.join(oldDraftDir, 'stop_qr_old.json'), JSON.stringify({
    version: 1, receipt_id: 'qr_old', quarantined: true, probable_draft: true,
    recorded_at: '2026-01-01T00:00:00.000Z', final_message: 'ancient draft'
  }), 'utf8');
  const pruned = store.pruneQuarantinedDrafts();
  check(pruned === 1, 'expired draft pruned');
  check(!fs.existsSync(oldDraftDir), 'empty draft dir removed after prune');
  check(fs.existsSync(path.join(root, 'quarantine', 'parent-session', 'legacy-phantom', 'stop_wr_legacy.json')),
    'non-draft quarantined receipt is never auto-pruned');
  check(fs.existsSync(qFiles[0]), 'recent draft survives the retention window');

  // ---- shared-tag bridge: external binding + external reconciliation ------
  const extActive = path.join(home, 'ext-tracker', 'active');
  fs.mkdirSync(extActive, { recursive: true });
  fs.writeFileSync(path.join(extActive, 'bc_external_1.json'), JSON.stringify({
    id: 'bc_external_1',
    owner: 'test_actor',
    name: 'external lead op',
    last_activity_at: '2026-08-11T23:00:00.000Z',
    steps: []
  }), 'utf8');
  const cfgPath = path.join(root, 'config.json');
  const cfgBefore = fs.existsSync(cfgPath) ? fs.readFileSync(cfgPath, 'utf8') : null;
  fs.writeFileSync(cfgPath, JSON.stringify({
    external_breadcrumb_dirs: [extActive],
    external_breadcrumb_owner: 'test_actor'
  }), 'utf8');
  // Close the local Autocache arc so the bridge leg is what binds.
  const activeBefore = fs.readFileSync(path.join(root, 'breadcrumbs', 'active.json'), 'utf8');
  fs.unlinkSync(path.join(root, 'breadcrumbs', 'active.json'));
  const snap = store.externalBreadcrumbSnapshot();
  check(snap.breadcrumb_id === 'bc_external_1' && snap.breadcrumb_source === 'external',
    'bridge binds to the newest external breadcrumb owned by the configured actor');
  runHook('subagent-start.js', {
    session_id: 'bridge-session',
    agent_id: 'bridge-worker',
    agent_type: 'explorer',
    hook_event_name: 'SubagentStart',
    cwd: repoRoot
  }, 'codex');
  const bridgeStop = runHook('subagent-stop.js', {
    session_id: 'bridge-session',
    agent_id: 'bridge-worker',
    agent_type: 'explorer',
    hook_event_name: 'SubagentStop',
    cwd: repoRoot,
    agent_transcript_path: path.join(home, 'bridge-worker.jsonl'),
    last_assistant_message: 'bridge probe done',
    stop_hook_active: false
  }, 'codex');
  check(JSON.parse(bridgeStop.stdout).systemMessage.includes('[worker:'),
    'bridge-bound stop still carries the reconciliation directive');
  const bridgeStopFile = filesUnder(path.join(root, 'workers', 'bridge-session'),
    (f) => path.basename(f).startsWith('stop_'))[0];
  const bridgeRec = JSON.parse(fs.readFileSync(bridgeStopFile, 'utf8'));
  check(bridgeRec.breadcrumb_id === 'bc_external_1' && bridgeRec.breadcrumb_source === 'external',
    'bridge-bound receipts carry the external breadcrumb id and source');
  check(!store.receiptReconciled(bridgeRec),
    'bridge receipt is pending before the external marker is written');
  fs.writeFileSync(path.join(extActive, 'bc_external_1.json'), JSON.stringify({
    id: 'bc_external_1',
    owner: 'test_actor',
    name: 'external lead op',
    last_activity_at: '2026-08-11T23:05:00.000Z',
    steps: ['verified bridge worker [worker:' + bridgeRec.receipt_id + ']']
  }), 'utf8');
  check(store.receiptReconciled(bridgeRec),
    'external marker reconciles the bridge receipt');
  // Regression (live bug 2026-08-12): a large date-dir archive must not push
  // the newest records past the collection cap - old dirs enumerate first in
  // readdir order, so an unordered capped walk never reaches the new marker.
  const extCompleted = path.join(home, 'ext-tracker', 'completed');
  const oldDay = path.join(extCompleted, '2026-01-01');
  fs.mkdirSync(oldDay, { recursive: true });
  for (let i = 0; i < 350; i++) {
    fs.writeFileSync(path.join(oldDay, 'bc_filler_' + String(i).padStart(3, '0') + '.json'),
      JSON.stringify({ id: 'bc_filler_' + i, steps: ['noise'] }), 'utf8');
  }
  const newDay = path.join(extCompleted, '2026-08-12');
  fs.mkdirSync(newDay, { recursive: true });
  fs.writeFileSync(path.join(newDay, 'bc_archived_lead.json'), JSON.stringify({
    id: 'bc_archived_lead',
    steps: ['reconciled after archive [worker:' + bridgeRec.receipt_id + '-arch]']
  }), 'utf8');
  check(store.externalRecordHasMarker('[worker:' + bridgeRec.receipt_id + '-arch]'),
    'marker in the NEWEST archive dir is found despite 350 older filler records');

  // Regression (live bug 2026-08-11): external reconciliation must survive a
  // store with NO local breadcrumbs dir at all - the readdir throw used to
  // abort before the external check ran.
  const bcDir = path.join(root, 'breadcrumbs');
  const bcTmp = path.join(root, 'breadcrumbs.hold');
  fs.renameSync(bcDir, bcTmp);
  check(store.receiptReconciled(bridgeRec),
    'external reconciliation still works with no local breadcrumbs dir');
  fs.renameSync(bcTmp, bcDir);
  fs.writeFileSync(path.join(root, 'breadcrumbs', 'active.json'), activeBefore, 'utf8');
  if (cfgBefore === null) fs.unlinkSync(cfgPath); else fs.writeFileSync(cfgPath, cfgBefore, 'utf8');

  // ---- scoped store root --------------------------------------------------
  check(store.home() === root, 'store root is the scoped path stores/<scope>');
  check(fs.existsSync(path.join(root, 'logs', 'events.jsonl')),
    'telemetry lands inside the scoped root');
  check(!fs.existsSync(path.join(home, 'logs')),
    'no state leaks to the unscoped base root');

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
