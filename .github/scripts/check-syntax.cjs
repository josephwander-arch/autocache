#!/usr/bin/env node
/**
 * Syntax check every .js/.cjs/.mjs file under hooks/, adapters/, and the CI scripts
 * themselves with `node --check`. Zero dependencies. Identical on Windows, macOS, Linux.
 *
 * `.github/scripts` is in the target list on purpose (added 2026-07-31 after an audit found
 * it missing): a CI script that is never itself syntax-checked can be broken and still report
 * green, because a crashing checker and a checker that found nothing both produce no failure
 * lines. A rule that exempts its own enforcer is not a rule.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const repoRoot = path.resolve(__dirname, '..', '..');
const TARGET_DIRS = ['hooks', 'adapters', path.join('.github', 'scripts')];

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
    } else if (entry.isFile() && /\.(js|cjs|mjs)$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

const files = [];
for (const dir of TARGET_DIRS) {
  walk(path.join(repoRoot, dir), files);
}
files.sort();

if (files.length === 0) {
  console.error('FAIL: no .js files found under ' + TARGET_DIRS.join('/, ') + '/');
  console.error('Autocache ships hooks. An empty hooks directory is a build error.');
  process.exit(1);
}

let failed = 0;
for (const file of files) {
  const rel = path.relative(repoRoot, file);
  const res = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
  if (res.status === 0) {
    console.log('ok    ' + rel);
  } else {
    failed += 1;
    console.error('FAIL  ' + rel);
    if (res.stderr) console.error(res.stderr.trim());
  }
}

console.log('');
console.log(files.length + ' file(s) checked, ' + failed + ' failure(s)');
process.exit(failed === 0 ? 0 : 1);
