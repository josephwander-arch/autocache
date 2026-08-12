// Unwritable-store contract for the bridge (decisions, per operation):
//
//   Every MUTATING tool must FAIL CLOSED when AUTOCACHE_HOME cannot be
//   written: throw (surfaced as isError by the tool layer) and create
//   nothing. store.writeJSON returns false on any failure and the bridge
//   converts that to a throw; the breadcrumb CLI exits non-zero, which
//   runBreadcrumbCli converts to a throw.
//
//   READS against an ABSENT store are not errors: absence is ordinary
//   empty-store state (status reports initialized: false). Only a file that
//   exists-but-cannot-parse is corruption - that contract lives in
//   corrupt-store.test.js.
//
// The unwritable home here is a path UNDER A REGULAR FILE, which fails
// directory creation on every platform without needing permission tricks.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test, { after } from 'node:test';

const blockerDir = fs.mkdtempSync(path.join(os.tmpdir(), 'autocache-mcp-unwritable-'));
const blockerFile = path.join(blockerDir, 'blocker');
fs.writeFileSync(blockerFile, 'not a directory', 'utf8');
const home = path.join(blockerFile, 'store');

process.env.AUTOCACHE_HOME = home;
process.env.AUTOCACHE_STORE_SCOPE = 'unwritable-test';
process.env.AUTOCACHE_SCOPE = 'unwritable-test';

const { actions } = await import('../src/operations.js');

after(() => fs.rmSync(blockerDir, { recursive: true, force: true }));

test('checkpoint fails closed against an unwritable store', () => {
  assert.throws(
    () => actions.checkpoint({ label: 'must not land', summary: 'x' }),
    /could not be written/
  );
});

test('handoff fails closed against an unwritable store', () => {
  assert.throws(
    () => actions.handoff({ title: 'must not land' }),
    /could not be written/
  );
});

test('reminder add fails closed against an unwritable store', () => {
  assert.throws(
    () => actions.remindersAdd({ text: 'must not land' }),
    /could not be written/
  );
});

test('breadcrumb mutations fail closed against an unwritable store', () => {
  assert.throws(() => actions.breadcrumbStart({ name: 'must not land' }));
  assert.throws(() => actions.breadcrumbStep({ milestone: 'must not land' }));
});

test('nothing was created under the unwritable home', () => {
  assert.equal(fs.existsSync(home), false);
  assert.equal(fs.readFileSync(blockerFile, 'utf8'), 'not a directory');
});

test('reads treat the absent store as empty, not as an error', () => {
  const status = actions.status();
  assert.equal(status.ok, true);
  assert.equal(status.initialized, false);
  const resume = actions.resume();
  assert.equal(resume.ok, true);
  assert.equal(resume.latest_checkpoint, null);
});
