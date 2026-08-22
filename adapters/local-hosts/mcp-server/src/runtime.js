import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dirname = path.dirname(fileURLToPath(import.meta.url));
export const packageRoot = path.resolve(dirname, '..');
// Locate the AutoCache root by looking for the files we actually need, walking up
// from this module. The previous form hardcoded exactly four levels, which is only
// true inside an intact checkout: any packaged or relocated install resolved to the
// wrong directory and then threw "core files are missing", which reads like a
// corrupt download rather than a path assumption. AUTOCACHE_ROOT overrides.
function locateRepositoryRoot(start) {
  const override = process.env.AUTOCACHE_ROOT;
  if (override && fs.existsSync(path.join(override, 'hooks', 'lib', 'store.js'))) {
    return path.resolve(override);
  }
  let current = start;
  for (let depth = 0; depth < 8; depth += 1) {
    if (fs.existsSync(path.join(current, 'hooks', 'lib', 'store.js'))) return current;
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  // Preserve the historical guess so behaviour is unchanged in a normal checkout.
  return path.resolve(start, '../../../..');
}
export const repositoryRoot = locateRepositoryRoot(dirname);
export const breadcrumbCliPath = path.join(
  repositoryRoot,
  'skills',
  'autocache-breadcrumb',
  'scripts',
  'breadcrumb.js'
);
export const storePath = path.join(repositoryRoot, 'hooks', 'lib', 'store.js');

function normalizeName(value, fallback, max = 120) {
  const normalized = String(value || '')
    .trim()
    .replace(/[^A-Za-z0-9._-]+/g, '_')
    .replace(/^\.+/, '_')
    .slice(0, max);
  return normalized || fallback;
}

export const actor = normalizeName(process.env.AUTOCACHE_MCP_ACTOR, 'local-mcp', 80);

// AUTOCACHE_STORE_SCOPE is the public bridge setting. The shared AutoCache
// core currently consumes AUTOCACHE_SCOPE, so map it before loading store.js.
// Default to the actor identity so separately named hosts do not accidentally
// become concurrent writers to one live breadcrumb store.
export const scope = normalizeName(
  process.env.AUTOCACHE_STORE_SCOPE || process.env.AUTOCACHE_SCOPE,
  actor
);
process.env.AUTOCACHE_STORE_SCOPE = scope;
process.env.AUTOCACHE_SCOPE = scope;

const requestedWorkspace = process.env.AUTOCACHE_WORKSPACE
  ? path.resolve(process.env.AUTOCACHE_WORKSPACE)
  : process.cwd();
export const workspace = fs.existsSync(requestedWorkspace) ? requestedWorkspace : process.cwd();

if (!fs.existsSync(storePath) || !fs.existsSync(breadcrumbCliPath)) {
  throw new Error(
    'AutoCache core files are missing. Run this bridge from an intact AutoCache checkout.'
  );
}

const require = createRequire(import.meta.url);
export const store = require(storePath);

export function gitSnapshot(cwd = workspace) {
  const run = (args) => {
    try {
      return execFileSync('git', args, {
        cwd,
        encoding: 'utf8',
        maxBuffer: 64 * 1024,
        stdio: ['ignore', 'pipe', 'ignore'],
        timeout: 3000,
        windowsHide: true
      }).trim();
    } catch {
      return null;
    }
  };
  const branch = run(['rev-parse', '--abbrev-ref', 'HEAD']);
  const head = run(['rev-parse', '--short', 'HEAD']);
  const dirtyOutput = run(['status', '--porcelain']);
  return {
    branch,
    head,
    dirty: dirtyOutput === null ? null : dirtyOutput.length > 0
  };
}

export function runBreadcrumbCli(command, options = {}) {
  const args = [breadcrumbCliPath, command];
  const add = (flag, value) => {
    if (value === undefined || value === null || value === '') return;
    args.push(flag, String(value));
  };
  const addMany = (flag, values) => {
    for (const value of Array.isArray(values) ? values : []) add(flag, value);
  };

  add('--name', options.name);
  add('--text', options.text);
  addMany('--target', options.targets);
  addMany('--planned', options.plannedSteps);
  add('--surface', scope);
  add('--actor', actor);
  args.push('--json');

  const result = spawnSync(process.execPath, args, {
    cwd: workspace,
    env: {
      ...process.env,
      AUTOCACHE_SCOPE: scope,
      AUTOCACHE_STORE_SCOPE: scope
    },
    encoding: 'utf8',
    maxBuffer: 128 * 1024,
    shell: false,
    timeout: 10_000,
    windowsHide: true
  });

  if (result.error) {
    const message = result.error.code === 'ETIMEDOUT'
      ? 'breadcrumb command timed out'
      : 'breadcrumb command could not start';
    throw new Error(message);
  }
  if (result.status !== 0) {
    const message = String(result.stderr || result.stdout || 'breadcrumb command failed')
      .replace(/^AutoCache:\s*/i, '')
      .trim()
      .slice(0, 1000);
    throw new Error(message || 'breadcrumb command failed');
  }
  try {
    return JSON.parse(String(result.stdout || '').trim());
  } catch {
    throw new Error('breadcrumb command returned invalid JSON');
  }
}
