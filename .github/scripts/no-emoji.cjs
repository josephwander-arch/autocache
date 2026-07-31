#!/usr/bin/env node
/**
 * Emoji are chat-only in this project. They must never be written into files:
 * downstream tools that read and rewrite them mangle encodings, and hook output
 * lands in terminals with no reliable font coverage.
 *
 * Conservative detection: pictographic planes and the variation selector only,
 * so ASCII art and ordinary symbols are never flagged.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..', '..');
// `.github/scripts` was previously skipped because fail-open.cjs embedded raw control bytes,
// which made it read as binary. Those are JS escape sequences now, so the exemption is gone
// (2026-07-31). A no-emoji rule that exempts the directory containing the no-emoji rule can
// never fail, which is indistinguishable from passing.
const SKIP_DIRS = new Set(['node_modules', '.git']);
const TEXT_EXT = /\.(js|cjs|mjs|json|md|ps1|sh|yml|yaml|txt)$/;

// Supplementary pictographic planes, plus a short list of BMP emoji that carry
// emoji presentation in practice. Deliberately narrow to avoid false positives.
const EMOJI = /[\u{1F000}-\u{1FAFF}]|[\u{2705}\u{274C}\u{2728}\u{26A0}\u{2B50}\u{2757}\u{2764}]|\u{FE0F}/u;

function walk(dir, out) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (err) {
    return out;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    const rel = path.relative(repoRoot, full).split(path.sep).join('/');
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name) || SKIP_DIRS.has(rel)) continue;
      walk(full, out);
    } else if (entry.isFile() && TEXT_EXT.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

let failures = 0;
const files = walk(repoRoot, []).sort();

for (const file of files) {
  const rel = path.relative(repoRoot, file).split(path.sep).join('/');
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (err) {
    continue;
  }
  const lines = text.split(/\r?\n/);
  lines.forEach((line, i) => {
    if (EMOJI.test(line)) {
      failures += 1;
      console.error('FAIL  ' + rel + ':' + (i + 1) + ' :: emoji in a repository file');
    }
  });
}

console.log(files.length + ' text file(s) scanned, ' + failures + ' emoji occurrence(s)');
process.exit(failures === 0 ? 0 : 1);
