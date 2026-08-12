'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const cp = require('child_process');

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'autocache-breadcrumb-cli-'));
const cli = path.resolve(__dirname, '../../skills/autocache-breadcrumb/scripts/breadcrumb.js');
const env = Object.assign({}, process.env, { AUTOCACHE_HOME: home, AUTOCACHE_SCOPE: 'codex' });

function run(args, expected) {
  const result = cp.spawnSync(process.execPath, [cli].concat(args), { env, encoding: 'utf8' });
  assert.strictEqual(result.status, expected === undefined ? 0 : expected, result.stderr || result.stdout);
  return result;
}

function read(rel) {
  return JSON.parse(fs.readFileSync(path.join(home, 'stores', 'codex', rel), 'utf8'));
}

try {
  assert.match(run(['help']).stdout, /resolve\s+--id ID --chosen TEXT/);
  const started = run(['start', '--name', 'CLI proof | targets: sample.txt', '--target', 'sample.txt', '--planned', 'write schema', '--planned', 'verify parser', '--json']);
  const first = JSON.parse(started.stdout);
  assert.match(first.id, /^bc[_-]/);
  assert.strictEqual(first.status, 'open');
  assert.strictEqual(read('breadcrumbs/active.json').breadcrumb_id, first.id);

  run(['start', '--name', 'duplicate'], 1);
  run(['step', '--text', 'write schema', '--json']);
  run(['add', '--text', 'ship documentation', '--json']);
  const decision = JSON.parse(run(['decide', '--question', 'Which parser?', '--option', 'A', '--option', 'B', '--waits-on', 'user', '--json']).stdout);
  const decisionId = decision.decisions[0].id;
  run(['resolve', '--id', decisionId, '--chosen', 'A', '--decided-by', 'codex'], 1);
  run(['resolve', '--id', decisionId, '--chosen', 'A', '--decided-by', 'user', '--json']);
  run(['backup', '--json']);

  const forked = JSON.parse(run(['fork', '--id', first.id, '--json']).stdout);
  assert.strictEqual(forked.forked_from, first.id);
  assert.notStrictEqual(forked.id, first.id);
  assert.strictEqual(read('breadcrumbs/' + first.id + '.json').forked_to, forked.id);

  run(['step', '--text', 'verify parser', '--json']);
  run(['complete', '--text', 'CLI lifecycle proven', '--json']);
  assert.strictEqual(read('breadcrumbs/active.json').breadcrumb_id, null);
  assert.strictEqual(read('breadcrumbs/' + first.id + '.json').status, 'complete');
  assert.strictEqual(read('breadcrumbs/' + first.id + '.json').completed_via, forked.id);

  const second = JSON.parse(run(['start', '--name', 'abort proof | targets: none', '--json']).stdout);
  run(['abort', '--text', 'test cleanup path', '--json']);
  assert.strictEqual(read('breadcrumbs/' + second.id + '.json').status, 'aborted');

  const listed = JSON.parse(run(['list', '--json']).stdout);
  assert.ok(listed.length >= 3);
  process.stdout.write('breadcrumb CLI: PASS\n');
} finally {
  fs.rmSync(home, { recursive: true, force: true });
}
