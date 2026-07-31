#!/usr/bin/env node
/*
 * Autocache - Codex adapter installer.
 *
 * Materializes the shared Autocache skills and Node hook scripts into the real
 * Codex directories and registers the hooks in ~/.codex/hooks.json.
 *
 * Node standard library only. No npm dependencies. Cross-platform.
 *
 * Guarantees:
 *   - idempotent: a second run reports "unchanged" and writes nothing
 *   - archive-first: hooks.json is backed up before any modifying write
 *   - atomic: every write goes to <file>.tmp and is then renamed into place
 *   - it never writes, moves, or overwrites a file under ~/.autocache
 *   - exit code is non-zero only on a genuine failure
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const VERSION = '0.1.0';

/* ------------------------------------------------------------------ config */

// Repository hook file -> Codex hook event. Only files that exist are registered.
const HOOK_EVENTS = [
  {
    file: 'session-start.js',
    event: 'SessionStart',
    matcher: 'startup|resume|clear|compact',
    timeout: 10,
    statusMessage: 'Autocache restoring prior context'
  },
  {
    file: 'user-prompt-submit.js',
    event: 'UserPromptSubmit',
    timeout: 5,
    statusMessage: 'Autocache prior-work check'
  },
  {
    file: 'pre-tool-use.js',
    event: 'PreToolUse',
    matcher: '*',
    timeout: 5,
    statusMessage: 'Autocache advisory'
  },
  {
    file: 'post-tool-use.js',
    event: 'PostToolUse',
    matcher: '*',
    timeout: 5,
    statusMessage: 'Autocache breadcrumb step'
  },
  {
    file: 'stop.js',
    event: 'Stop',
    timeout: 10,
    statusMessage: 'Autocache checkpoint'
  }
];

// Marker that identifies a hook registration as ours, for idempotent replacement
// and for uninstall. Kept as a path fragment so it cannot match a user's own hook.
const HOOK_MARKER = 'hooks/autocache/';
const SKILL_PREFIX = 'autocache-';
const BACKUPS_KEPT = 3;

/* -------------------------------------------------------------------- args */

function parseArgs(argv) {
  const opts = {
    dryRun: false,
    link: false,
    uninstall: false,
    help: false,
    quiet: false,
    codexHome: process.env.CODEX_HOME || null,
    repoRoot: null
  };
  for (const raw of argv) {
    if (raw === '--dry-run' || raw === '-n') opts.dryRun = true;
    else if (raw === '--link') opts.link = true;
    else if (raw === '--uninstall') opts.uninstall = true;
    else if (raw === '--quiet' || raw === '-q') opts.quiet = true;
    else if (raw === '--help' || raw === '-h') opts.help = true;
    else if (raw.startsWith('--codex-home=')) opts.codexHome = raw.slice('--codex-home='.length);
    else if (raw.startsWith('--repo=')) opts.repoRoot = raw.slice('--repo='.length);
    else throw new Error('unknown option: ' + raw);
  }
  return opts;
}

const HELP = [
  'Autocache - Codex adapter installer (v' + VERSION + ')',
  '',
  'Usage: node adapters/codex/install.js [options]',
  '',
  '  --dry-run, -n        print the plan, write nothing',
  '  --link               symlink hooks and skills instead of copying',
  '                       (falls back to copying when the OS refuses)',
  '  --uninstall          remove what this installer added (never touches state)',
  '  --codex-home=<path>  install into a different Codex home (or set CODEX_HOME)',
  '  --repo=<path>        use a different repository root',
  '  --quiet, -q          only print the summary',
  '  --help, -h           this text',
  '',
  'State root: $AUTOCACHE_HOME, else ~/.autocache. Never overwritten.'
].join('\n');

/* ------------------------------------------------------------------ report */

const report = [];
let failures = 0;

function record(status, action, target, detail) {
  report.push({ status, action, target, detail: detail || '' });
  if (status === 'fail') failures += 1;
}

function say(opts, line) {
  if (!opts.quiet) process.stdout.write(line + '\n');
}

/* ------------------------------------------------------------- fs helpers */

function exists(p) {
  try {
    fs.lstatSync(p);
    return true;
  } catch (err) {
    return false;
  }
}

function isDir(p) {
  try {
    return fs.statSync(p).isDirectory();
  } catch (err) {
    return false;
  }
}

function ensureDir(p, opts) {
  if (isDir(p)) return;
  if (opts.dryRun) return;
  fs.mkdirSync(p, { recursive: true });
}

// Atomic: write <dest>.tmp in the same directory, then rename over dest.
function writeFileAtomic(dest, data) {
  const tmp = dest + '.tmp';
  fs.writeFileSync(tmp, data);
  fs.renameSync(tmp, dest);
}

function sameContent(src, dest) {
  try {
    const a = fs.readFileSync(src);
    const b = fs.readFileSync(dest);
    return Buffer.compare(a, b) === 0;
  } catch (err) {
    return false;
  }
}

function linkPointsAt(dest, src) {
  try {
    if (!fs.lstatSync(dest).isSymbolicLink()) return false;
    return path.resolve(path.dirname(dest), fs.readlinkSync(dest)) === path.resolve(src);
  } catch (err) {
    return false;
  }
}

// Returns 'created' | 'updated' | 'unchanged' | 'linked'.
function placeFile(src, dest, opts) {
  ensureDir(path.dirname(dest), opts);

  if (opts.link) {
    if (linkPointsAt(dest, src)) return 'unchanged';
    if (opts.dryRun) return exists(dest) ? 'updated' : 'linked';
    try {
      if (exists(dest)) fs.rmSync(dest, { force: true });
      fs.symlinkSync(src, dest, 'file');
      return 'linked';
    } catch (err) {
      // Windows without Developer Mode or elevation refuses symlinks. Copy instead.
    }
  }

  const existed = exists(dest);
  if (existed && !linkPointsAt(dest, src) && sameContent(src, dest)) return 'unchanged';
  if (opts.dryRun) return existed ? 'updated' : 'created';
  if (existed && fs.lstatSync(dest).isSymbolicLink()) fs.rmSync(dest, { force: true });
  writeFileAtomic(dest, fs.readFileSync(src));
  return existed ? 'updated' : 'created';
}

function listFilesRecursive(root, rel) {
  const out = [];
  const base = rel ? path.join(root, rel) : root;
  let entries;
  try {
    entries = fs.readdirSync(base, { withFileTypes: true });
  } catch (err) {
    return out;
  }
  for (const entry of entries) {
    if (entry.name === '.tmp' || entry.name.endsWith('.tmp')) continue;
    const childRel = rel ? path.join(rel, entry.name) : entry.name;
    if (entry.isDirectory()) out.push.apply(out, listFilesRecursive(root, childRel));
    else out.push(childRel);
  }
  return out;
}

function placeTree(srcDir, destDir, opts, label) {
  const files = listFilesRecursive(srcDir, '');
  if (files.length === 0) {
    record('skip', 'skipped', label, 'nothing to install');
    return;
  }
  for (const rel of files) {
    const src = path.join(srcDir, rel);
    const dest = path.join(destDir, rel);
    try {
      const status = placeFile(src, dest, opts);
      record(status === 'unchanged' ? 'ok' : 'write', status, dest);
    } catch (err) {
      record('fail', 'failed', dest, err.message);
    }
  }
}

function removePath(target, opts) {
  if (!exists(target)) return false;
  if (!opts.dryRun) fs.rmSync(target, { recursive: true, force: true });
  return true;
}

/* --------------------------------------------------------------- hooks.json */

function shellQuote(p) {
  // Codex runs the command through a shell. Windows home directories contain
  // spaces, so the path is always quoted.
  return '"' + p.split(path.sep).join('/') + '"';
}

function isOurs(entry) {
  return !!(entry && typeof entry.command === 'string' && entry.command.indexOf(HOOK_MARKER) !== -1);
}

function stripOurs(config) {
  const events = config.hooks;
  for (const eventName of Object.keys(events)) {
    const groups = Array.isArray(events[eventName]) ? events[eventName] : [];
    const kept = [];
    for (const group of groups) {
      if (!group || !Array.isArray(group.hooks)) {
        kept.push(group);
        continue;
      }
      const hooks = group.hooks.filter(function (h) {
        return !isOurs(h);
      });
      if (hooks.length === 0 && group.hooks.length > 0) continue; // group was entirely ours
      kept.push(Object.assign({}, group, { hooks: hooks }));
    }
    if (kept.length === 0) delete events[eventName];
    else events[eventName] = kept;
  }
  return config;
}

function pruneBackups(dir, prefix, opts) {
  let names;
  try {
    names = fs.readdirSync(dir).filter(function (n) {
      return n.indexOf(prefix) === 0;
    });
  } catch (err) {
    return;
  }
  names.sort();
  while (names.length > BACKUPS_KEPT) {
    const oldest = names.shift();
    if (!opts.dryRun) {
      try {
        fs.rmSync(path.join(dir, oldest), { force: true });
      } catch (err) {
        /* fail quietly, a stale backup is not a failure */
      }
    }
  }
}

function updateHookConfig(codexHome, hooksDest, repoHooksDir, opts) {
  const configPath = path.join(codexHome, 'hooks.json');
  let original = null;
  let config = { hooks: {} };

  if (exists(configPath)) {
    original = fs.readFileSync(configPath, 'utf8');
    try {
      const parsed = JSON.parse(original);
      config = parsed && typeof parsed === 'object' ? parsed : { hooks: {} };
    } catch (err) {
      record('fail', 'failed', configPath, 'existing file is not valid JSON - refusing to replace it');
      return;
    }
  }
  if (!config.hooks || typeof config.hooks !== 'object' || Array.isArray(config.hooks)) {
    config.hooks = {};
  }

  const before = JSON.stringify(config);
  stripOurs(config);

  if (!opts.uninstall) {
    for (const spec of HOOK_EVENTS) {
      if (!exists(path.join(repoHooksDir, spec.file))) continue;
      const entry = {
        type: 'command',
        command: 'node ' + shellQuote(path.join(hooksDest, spec.file)) + ' --surface=codex',
        timeout: spec.timeout,
        statusMessage: spec.statusMessage
      };
      const group = { hooks: [entry] };
      if (spec.matcher) group.matcher = spec.matcher;
      if (!Array.isArray(config.hooks[spec.event])) config.hooks[spec.event] = [];
      config.hooks[spec.event].push(group);
    }
  }

  const after = JSON.stringify(config, null, 2) + '\n';
  if (original !== null && JSON.stringify(JSON.parse(original)) === JSON.stringify(config)) {
    record('ok', 'unchanged', configPath, 'hook registrations already current');
    return;
  }
  if (original === null && before === JSON.stringify(config) && opts.uninstall) {
    record('ok', 'unchanged', configPath, 'nothing registered');
    return;
  }

  if (opts.dryRun) {
    record('write', original === null ? 'would create' : 'would update', configPath,
      opts.uninstall ? 'deregister Autocache hooks' : 'register Autocache hooks');
    return;
  }

  try {
    ensureDir(codexHome, opts);
    if (original !== null) {
      // Archive first. Never modify a working config without a copy beside it.
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      const backup = configPath + '.autocache-backup-' + stamp;
      writeFileAtomic(backup, original);
      pruneBackups(codexHome, 'hooks.json.autocache-backup-', opts);
    }
    writeFileAtomic(configPath, after);
    record('write', original === null ? 'created' : 'updated', configPath,
      opts.uninstall ? 'Autocache hooks deregistered' : 'Autocache hooks registered');
  } catch (err) {
    record('fail', 'failed', configPath, err.message);
  }
}

/* -------------------------------------------------------------------- main */

function stateRoot() {
  return process.env.AUTOCACHE_HOME && process.env.AUTOCACHE_HOME.trim()
    ? process.env.AUTOCACHE_HOME
    : path.join(os.homedir(), '.autocache');
}

function ensureStateRoot(opts) {
  const root = stateRoot();
  if (isDir(root)) {
    record('ok', 'unchanged', root, 'existing state left untouched');
    return;
  }
  if (opts.dryRun) {
    record('write', 'would create', root, 'state root');
    return;
  }
  try {
    fs.mkdirSync(root, { recursive: true });
    record('write', 'created', root, 'state root');
  } catch (err) {
    record('fail', 'failed', root, err.message);
  }
}

function skillDirName(name) {
  return name.indexOf(SKILL_PREFIX) === 0 ? name : SKILL_PREFIX + name;
}

function installSkills(repoRoot, codexHome, opts) {
  const src = path.join(repoRoot, 'skills');
  if (!isDir(src)) {
    record('skip', 'skipped', path.join(codexHome, 'skills'), 'no skills/ in repository');
    return;
  }
  const names = fs.readdirSync(src, { withFileTypes: true })
    .filter(function (d) { return d.isDirectory(); })
    .map(function (d) { return d.name; });
  if (names.length === 0) {
    record('skip', 'skipped', path.join(codexHome, 'skills'), 'no skills found');
    return;
  }
  for (const name of names) {
    placeTree(
      path.join(src, name),
      path.join(codexHome, 'skills', skillDirName(name)),
      opts,
      path.join(codexHome, 'skills', skillDirName(name))
    );
  }
}

function installAgents(repoRoot, codexHome, opts) {
  const src = path.join(repoRoot, 'agents');
  if (!isDir(src)) return;
  const files = fs.readdirSync(src).filter(function (n) { return n.endsWith('.md'); });
  for (const name of files) {
    const destName = name.indexOf(SKILL_PREFIX) === 0 ? name : SKILL_PREFIX + name;
    const dest = path.join(codexHome, 'agents', destName);
    try {
      const status = placeFile(path.join(src, name), dest, opts);
      record(status === 'unchanged' ? 'ok' : 'write', status, dest);
    } catch (err) {
      record('fail', 'failed', dest, err.message);
    }
  }
}

function installRules(codexHome, opts) {
  const src = path.join(__dirname, 'rules', 'autocache.md');
  const dest = path.join(codexHome, 'rules', 'autocache.md');
  if (!exists(src)) {
    record('fail', 'failed', dest, 'adapter rules file is missing from the repository');
    return;
  }
  try {
    const status = placeFile(src, dest, opts);
    record(status === 'unchanged' ? 'ok' : 'write', status, dest);
  } catch (err) {
    record('fail', 'failed', dest, err.message);
  }
}

function uninstall(repoRoot, codexHome, opts) {
  const targets = [];
  const skillsDir = path.join(codexHome, 'skills');
  if (isDir(skillsDir)) {
    for (const name of fs.readdirSync(skillsDir)) {
      if (name.indexOf(SKILL_PREFIX) === 0) targets.push(path.join(skillsDir, name));
    }
  }
  const agentsDir = path.join(codexHome, 'agents');
  if (isDir(agentsDir)) {
    for (const name of fs.readdirSync(agentsDir)) {
      if (name.indexOf(SKILL_PREFIX) === 0 && name.endsWith('.md')) {
        targets.push(path.join(agentsDir, name));
      }
    }
  }
  targets.push(path.join(codexHome, 'hooks', 'autocache'));
  targets.push(path.join(codexHome, 'rules', 'autocache.md'));

  for (const target of targets) {
    try {
      if (!exists(target)) {
        record('ok', 'absent', target);
      } else if (opts.dryRun) {
        record('write', 'would remove', target);
      } else {
        removePath(target, opts);
        record('write', 'removed', target);
      }
    } catch (err) {
      record('fail', 'failed', target, err.message);
    }
  }

  updateHookConfig(codexHome, path.join(codexHome, 'hooks', 'autocache'),
    path.join(repoRoot, 'hooks'), opts);

  record('ok', 'kept', stateRoot(), 'state is never removed by uninstall');
}

function main() {
  let opts;
  try {
    opts = parseArgs(process.argv.slice(2));
  } catch (err) {
    process.stderr.write(err.message + '\n\n' + HELP + '\n');
    return 2;
  }
  if (opts.help) {
    process.stdout.write(HELP + '\n');
    return 0;
  }

  const repoRoot = opts.repoRoot ? path.resolve(opts.repoRoot) : path.resolve(__dirname, '..', '..');
  const codexHome = opts.codexHome ? path.resolve(opts.codexHome) : path.join(os.homedir(), '.codex');
  const hooksDest = path.join(codexHome, 'hooks', 'autocache');
  const repoHooks = path.join(repoRoot, 'hooks');

  say(opts, 'Autocache - Codex adapter ' + (opts.uninstall ? 'uninstall' : 'install') +
    (opts.dryRun ? ' (dry run)' : ''));
  say(opts, '  repository : ' + repoRoot);
  say(opts, '  codex home : ' + codexHome);
  say(opts, '  state root : ' + stateRoot() + (opts.uninstall ? '' : ' (shared, never overwritten)'));
  say(opts, '');

  if (opts.uninstall) {
    uninstall(repoRoot, codexHome, opts);
  } else {
    if (!isDir(codexHome)) ensureDir(codexHome, opts);
    ensureStateRoot(opts);
    installSkills(repoRoot, codexHome, opts);
    if (isDir(repoHooks)) {
      placeTree(repoHooks, hooksDest, opts, hooksDest);
    } else {
      record('fail', 'failed', hooksDest, 'no hooks/ directory in the repository');
    }
    installRules(codexHome, opts);
    installAgents(repoRoot, codexHome, opts);
    updateHookConfig(codexHome, hooksDest, repoHooks, opts);
  }

  let changed = 0;
  let unchanged = 0;
  for (const row of report) {
    if (row.status === 'write') changed += 1;
    else if (row.status === 'ok') unchanged += 1;
    if (!opts.quiet) {
      const prefix = opts.dryRun && row.status === 'write' ? wouldize(row.action) : row.action;
      say(opts, '  ' + pad(prefix, 14) + ' ' + row.target + (row.detail ? '   (' + row.detail + ')' : ''));
    }
  }

  const verb = opts.dryRun ? 'planned' : 'applied';
  process.stdout.write('\n' + (failures ? 'FAILED' : 'OK') + ': ' + changed + ' change(s) ' + verb +
    ', ' + unchanged + ' already current, ' + failures + ' failure(s).\n');
  // Machine-readable trailer, parsed by install.sh / install.ps1 for the result table.
  process.stdout.write('AUTOCACHE_RESULT changed=' + changed + ' unchanged=' + unchanged +
    ' failures=' + failures + ' mode=' +
    (opts.uninstall ? 'uninstall' : opts.dryRun ? 'dry-run' : 'install') + '\n');
  if (!failures && !opts.uninstall && !opts.dryRun) {
    process.stdout.write('Restart Codex or start a new session for the hooks to load.\n');
  }
  return failures ? 1 : 0;
}

function pad(s, n) {
  return s.length >= n ? s : s + ' '.repeat(n - s.length);
}

// Past-tense action labels become "would <verb>" in a dry run.
const WOULD = {
  created: 'would create',
  updated: 'would update',
  linked: 'would link',
  removed: 'would remove'
};

function wouldize(action) {
  if (action.indexOf('would') === 0) return action;
  return WOULD[action] || 'would ' + action;
}

let code = 0;
try {
  code = main();
} catch (err) {
  process.stderr.write('autocache codex installer failed: ' + (err && err.message ? err.message : err) + '\n');
  code = 1;
}
process.exit(code);
