#!/usr/bin/env node
/**
 * Parse every .json file in the repository and assert it is valid JSON.
 * Additionally shape-checks the manifests Autocache cannot ship broken.
 * Zero dependencies.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..', '..');
const SKIP_DIRS = new Set(['node_modules', '.git']);

function walk(dir, out) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (err) {
    return out;
  }
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      walk(path.join(dir, entry.name), out);
    } else if (entry.isFile() && entry.name.endsWith('.json')) {
      out.push(path.join(dir, entry.name));
    }
  }
  return out;
}

const files = walk(repoRoot, []).sort();
let failed = 0;
const parsed = new Map();

for (const file of files) {
  const rel = path.relative(repoRoot, file).split(path.sep).join('/');
  try {
    const doc = JSON.parse(fs.readFileSync(file, 'utf8'));
    parsed.set(rel, doc);
    console.log('ok    ' + rel);
  } catch (err) {
    failed += 1;
    console.error('FAIL  ' + rel + ' :: ' + err.message);
  }
}

// Shape checks for the manifests that must not ship malformed.
function requireFields(rel, obj, fields) {
  if (!obj || typeof obj !== 'object') {
    console.error('FAIL  ' + rel + ' :: expected a JSON object');
    return 1;
  }
  let bad = 0;
  for (const field of fields) {
    if (!(field in obj)) {
      console.error('FAIL  ' + rel + ' :: missing required field "' + field + '"');
      bad += 1;
    }
  }
  return bad === 0 ? 0 : 1;
}

const pluginManifest = '.claude-plugin/plugin.json';
if (parsed.has(pluginManifest)) {
  failed += requireFields(pluginManifest, parsed.get(pluginManifest), [
    'name',
    'description',
    'version'
  ]);
}

const hooksManifest = 'hooks/hooks.json';
if (parsed.has(hooksManifest)) {
  const doc = parsed.get(hooksManifest);
  // Accept both shapes: { "SessionStart": [...] } and { hooks: { "SessionStart": [...] } }.
  const eventMap =
    doc && typeof doc === 'object' && doc.hooks && typeof doc.hooks === 'object' && !Array.isArray(doc.hooks)
      ? doc.hooks
      : doc;
  if (!eventMap || typeof eventMap !== 'object' || Array.isArray(eventMap)) {
    console.error('FAIL  ' + hooksManifest + ' :: expected an object keyed by event name');
    failed += 1;
  } else {
    const KNOWN_EVENTS = new Set([
      'SessionStart',
      'SessionEnd',
      'UserPromptSubmit',
      'PreToolUse',
      'PostToolUse',
      'Notification',
      'Stop',
      'SubagentStart',
      'SubagentStop',
      'TaskCreated',
      'TaskCompleted',
      'TeammateIdle',
      'PreCompact'
    ]);
    for (const [event, matchers] of Object.entries(eventMap)) {
      if (!KNOWN_EVENTS.has(event)) {
        console.error('FAIL  ' + hooksManifest + ' :: unknown hook event "' + event + '"');
        failed += 1;
        continue;
      }
      if (!Array.isArray(matchers)) {
        console.error('FAIL  ' + hooksManifest + ' :: "' + event + '" must be an array');
        failed += 1;
        continue;
      }
      for (const matcher of matchers) {
        const entries = matcher && matcher.hooks;
        if (!Array.isArray(entries)) {
          console.error('FAIL  ' + hooksManifest + ' :: "' + event + '" entry has no hooks array');
          failed += 1;
          continue;
        }
        for (const hook of entries) {
          if (!hook || hook.type !== 'command' || typeof hook.command !== 'string') {
            console.error('FAIL  ' + hooksManifest + ' :: "' + event + '" hook must be {type:"command", command:string}');
            failed += 1;
            continue;
          }
          // Windows plugin paths contain spaces. The substitution must be quoted.
          if (hook.command.includes('${CLAUDE_PLUGIN_ROOT}') && !hook.command.includes('"${CLAUDE_PLUGIN_ROOT}')) {
            console.error('FAIL  ' + hooksManifest + ' :: unquoted ${CLAUDE_PLUGIN_ROOT} in "' + event + '" command');
            failed += 1;
          }
        }
      }
    }
  }
}

console.log('');
console.log(files.length + ' JSON file(s) checked, ' + failed + ' failure(s)');
process.exit(failed === 0 ? 0 : 1);
