#!/usr/bin/env node
/**
 * FAIL-OPEN REGRESSION TEST - the most important job in CI.
 *
 * A continuity tool that breaks the session it is meant to protect is worse than
 * no tool. Every hook and every adapter must exit 0 no matter what it is fed:
 * malformed stdin, empty stdin, a nonexistent or unwritable AUTOCACHE_HOME, a
 * corrupt state directory. This script pipes each of those into every script
 * under hooks/ and adapters/ and asserts the exit code is 0 in every case.
 *
 * It also asserts that stdout, when it looks like JSON, actually parses - a hook
 * that emits half an object corrupts the harness payload even while exiting 0.
 *
 * Zero dependencies. Runs on Windows, macOS, and Linux.
 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const repoRoot = path.resolve(__dirname, '..', '..');
const TARGET_DIRS = ['hooks', 'adapters'];
const HOOK_TIMEOUT_MS = 20000;

// Installers are excluded: they are not in the session path, so they cannot break a
// session, and probing them repeatedly would actually install. Everything else under
// hooks/ and adapters/ - including shared libraries - is probed, because a library
// that throws on load takes its hook down with it.
const SKIP_FILE = /(^|[-_.])install(er)?\.(js|cjs|mjs)$/i;

const isWindows = process.platform === 'win32';
const isRoot = typeof process.getuid === 'function' && process.getuid() === 0;

// ---------------------------------------------------------------- discovery

function walk(dir, out) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (err) {
    return out;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === '.git') continue;
      walk(full, out);
    } else if (entry.isFile() && /\.(js|cjs|mjs)$/.test(entry.name) && !SKIP_FILE.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

const scripts = [];
for (const dir of TARGET_DIRS) {
  walk(path.join(repoRoot, dir), scripts);
}
scripts.sort();

if (scripts.length === 0) {
  console.error('FAIL: no hook or adapter scripts found under ' + TARGET_DIRS.join('/, ') + '/');
  console.error('The fail-open guarantee cannot be verified against nothing.');
  process.exit(1);
}

// ---------------------------------------------------------------- sandboxes

const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'autocache-failopen-'));

function sandboxPath(...parts) {
  return path.join(sandbox, ...parts);
}

// A path that simply does not exist, several levels deep.
const missingHome = sandboxPath('does', 'not', 'exist', 'anywhere', '.autocache');

// A regular file standing where a directory is expected: mkdir must fail.
const fileAsHome = sandboxPath('home-is-a-file');
fs.writeFileSync(fileAsHome, 'not a directory\n');

// A path whose PARENT is a regular file: recursive mkdir must fail too.
const homeUnderFile = path.join(fileAsHome, '.autocache');

// A state directory full of corrupt JSON.
const corruptHome = sandboxPath('corrupt-home');
fs.mkdirSync(path.join(corruptHome, 'sessions'), { recursive: true });
fs.mkdirSync(path.join(corruptHome, 'breadcrumbs'), { recursive: true });
fs.mkdirSync(path.join(corruptHome, 'checkpoints'), { recursive: true });
fs.mkdirSync(path.join(corruptHome, 'state'), { recursive: true });
fs.mkdirSync(path.join(corruptHome, 'logs'), { recursive: true });
fs.writeFileSync(path.join(corruptHome, 'config.json'), '{"version": 1, "tel');
fs.writeFileSync(path.join(corruptHome, 'reminders.json'), 'not json at all');
fs.writeFileSync(path.join(corruptHome, 'sessions', 'index.json'), '[[[');
fs.writeFileSync(path.join(corruptHome, 'sessions', 'ses_broken.json'), '');
fs.writeFileSync(path.join(corruptHome, 'breadcrumbs', 'active.json'), '{"breadcrumb_id": "bc_missing_file"}');
fs.writeFileSync(path.join(corruptHome, 'state', 'self_state.json'), '\x00\x01\x02');
fs.writeFileSync(path.join(corruptHome, 'state', 'bag.json'), '{"tags":');
fs.writeFileSync(path.join(corruptHome, 'logs', 'events.jsonl'), '{"ts":"broken"\n{"also":');

// A perfectly good, writable state root - the control case.
const goodHome = sandboxPath('good-home');
fs.mkdirSync(goodHome, { recursive: true });

// Stands in for the OS home directory on every probe, so a hook falling back to
// os.homedir() still cannot touch the real one.
const throwawayHome = sandboxPath('os-home');
fs.mkdirSync(throwawayHome, { recursive: true });

// A directory with permissions stripped. POSIX only, and meaningless as root.
let unreadableHome = null;
if (!isWindows && !isRoot) {
  unreadableHome = sandboxPath('unreadable-home');
  fs.mkdirSync(unreadableHome, { recursive: true });
  try {
    fs.chmodSync(unreadableHome, 0o000);
  } catch (err) {
    unreadableHome = null;
  }
}

// ---------------------------------------------------------------- payloads

const validPayload = JSON.stringify({
  session_id: 'ci-fail-open',
  transcript_path: path.join(sandbox, 'transcript.jsonl'),
  cwd: repoRoot,
  hook_event_name: 'PostToolUse',
  source: 'startup',
  prompt: 'ci fail-open probe',
  tool_name: 'Write',
  tool_input: { file_path: path.join(sandbox, 'probe.txt'), content: 'x' },
  tool_response: { success: true },
  stop_hook_active: false
});

const nullFieldsPayload = JSON.stringify({
  session_id: null,
  transcript_path: null,
  cwd: null,
  hook_event_name: null,
  tool_name: null,
  tool_input: null,
  tool_response: null,
  prompt: null
});

const STDIN_CASES = [
  ['empty stdin', ''],
  ['whitespace only', '   \n\t  \n'],
  ['malformed json', '{ this is not json'],
  ['truncated json', '{"hook_event_name":"SessionStart","cwd":'],
  ['plain text', 'hello, not a payload at all'],
  ['json array', '[]'],
  ['json null', 'null'],
  ['json string', '"just a string"'],
  ['binary garbage', '\x00\x01\x02 not-json ÿ'],
  ['huge junk line', 'x'.repeat(200000)],
  ['null-valued fields', nullFieldsPayload],
  ['valid payload', validPayload]
];

const HOME_CASES = [
  ['writable home', goodHome],
  ['nonexistent home', missingHome],
  ['home is a file', fileAsHome],
  ['home under a file', homeUnderFile],
  ['corrupt state', corruptHome],
  ['empty AUTOCACHE_HOME var', ''],
  ['relative AUTOCACHE_HOME', '.autocache-relative-probe']
];
if (unreadableHome) {
  HOME_CASES.push(['unreadable home', unreadableHome]);
}

// ---------------------------------------------------------------- the probe

let failures = 0;
let runs = 0;

function probe(script, label, input, home, cwd) {
  const env = Object.assign({}, process.env);
  if (home === null) {
    delete env.AUTOCACHE_HOME;
  } else {
    env.AUTOCACHE_HOME = home;
  }
  // Never let a probe reach the real developer state directory. Every fallback
  // path - AUTOCACHE_HOME unset, empty, or unusable - lands in the sandbox.
  env.HOME = throwawayHome;
  env.USERPROFILE = throwawayHome;
  env.AUTOCACHE_CI = '1';

  const res = spawnSync(process.execPath, [script], {
    input,
    env,
    cwd: cwd || repoRoot,
    encoding: 'utf8',
    timeout: HOOK_TIMEOUT_MS,
    maxBuffer: 32 * 1024 * 1024
  });

  runs += 1;
  const rel = path.relative(repoRoot, script).split(path.sep).join('/');
  const problems = [];

  if (res.error && res.error.code === 'ETIMEDOUT') {
    problems.push('hung past ' + HOOK_TIMEOUT_MS + 'ms and was killed');
  } else if (res.error && (res.error.code === 'EPIPE' || res.error.code === 'EOF') && res.status === 0) {
    // The child exited cleanly without draining stdin, so the parent's write was
    // refused. That is correct behavior for a script that ignores stdin - not a
    // fail-open violation. Only the exit code decides.
  } else if (res.error) {
    problems.push('spawn error: ' + res.error.message);
  }
  if (res.signal) {
    problems.push('terminated by signal ' + res.signal);
  }
  if (res.status !== 0) {
    problems.push('exit code ' + res.status + ' (must be 0)');
  }

  const out = (res.stdout || '').trim();
  if (out && (out.startsWith('{') || out.startsWith('['))) {
    try {
      JSON.parse(out);
    } catch (err) {
      problems.push('stdout looks like JSON but does not parse: ' + err.message);
    }
  }

  if (problems.length) {
    failures += 1;
    console.error('FAIL  ' + rel + '  [' + label + ']');
    for (const problem of problems) {
      console.error('        ' + problem);
    }
    if (res.stderr && res.stderr.trim()) {
      console.error('        stderr: ' + res.stderr.trim().split('\n').slice(0, 6).join('\n        '));
    }
    if (out) {
      console.error('        stdout: ' + out.slice(0, 400));
    }
  }
}

console.log('fail-open regression');
console.log('  scripts:      ' + scripts.length);
console.log('  stdin cases:  ' + STDIN_CASES.length);
console.log('  home cases:   ' + HOME_CASES.length);
console.log('  sandbox:      ' + sandbox);
console.log('');

for (const script of scripts) {
  const rel = path.relative(repoRoot, script).split(path.sep).join('/');
  const failuresBefore = failures;

  // Every stdin case against a good, writable state root.
  for (const [label, input] of STDIN_CASES) {
    probe(script, 'stdin: ' + label, input, goodHome);
  }

  // Every state-root case against a valid payload. The relative-path case runs
  // from the sandbox so a hook that resolves it against cwd cannot litter the repo.
  for (const [label, home] of HOME_CASES) {
    const cwd = label === 'relative AUTOCACHE_HOME' ? sandbox : repoRoot;
    probe(script, 'home: ' + label, validPayload, home, cwd);
  }

  // The nastiest combinations: broken input AND broken state root.
  probe(script, 'combo: malformed stdin + nonexistent home', '{ broken', missingHome);
  probe(script, 'combo: empty stdin + home is a file', '', fileAsHome);
  probe(script, 'combo: binary stdin + corrupt state', '\x00\x01 junk', corruptHome);
  if (unreadableHome) {
    probe(script, 'combo: empty stdin + unreadable home', '', unreadableHome);
  }

  // AUTOCACHE_HOME unset entirely - the hook must fall back to os.homedir(),
  // which every probe has already pointed at the sandbox.
  probe(script, 'home: AUTOCACHE_HOME unset', validPayload, null);

  if (failures === failuresBefore) {
    console.log('ok    ' + rel);
  }
}

// ---------------------------------------------------------------- cleanup

if (unreadableHome) {
  try {
    fs.chmodSync(unreadableHome, 0o700);
  } catch (err) {
    /* best effort */
  }
}
try {
  fs.rmSync(sandbox, { recursive: true, force: true });
} catch (err) {
  /* best effort */
}

console.log('');
console.log(runs + ' probe(s) run, ' + failures + ' failure(s)');
if (failures > 0) {
  console.error('');
  console.error('A hook that does not fail open can break the session it exists to protect.');
  console.error('Wrap the hook body in try/catch and end every path in process.exit(0).');
  process.exit(1);
}
console.log('every hook and adapter exited 0 under every failure mode.');
process.exit(0);
