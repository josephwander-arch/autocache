// Corruption contract for the bridge (decisions, per operation):
//
//   A state file that EXISTS but cannot be parsed is corruption, never
//   absence. hooks/lib/store.js readJSON deliberately FAILS OPEN (returns the
//   fallback) because lifecycle hooks must never block a host session; the
//   bridge is a fail-closed server, so operations.js probes with a sentinel
//   and applies these per-operation decisions:
//
//   - breadcrumb start/step/complete/abort: FAIL CLOSED on a corrupt
//     breadcrumbs/active.json. A start could overwrite a damaged-but-
//     recoverable active record; steps/completes would silently retarget.
//     The shared CLI itself keeps hook semantics - the guard is bridge-side.
//   - status / resume: stay usable as diagnostics (ok: true) but SURFACE
//     corruption in a problems array; a corrupt active.json must not read as
//     "no active breadcrumb", and a damaged newest checkpoint must not read
//     as "no checkpoint".
//   - checkpoint / handoff: recovery tools - the write PROCEEDS, but any
//     state the packet could not truthfully embed is surfaced (checkpoint
//     names why breadcrumb_id was recorded null; handoff names a present-
//     but-damaged session record instead of a bare session_updated: false).
//   - reminders: precedent already in place - writes fail closed (strict
//     read), list/status surface corrupted: true (safety.test.js).
//   - self_state.json: NOT read by any bridge operation; out of scope here.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test, { after } from 'node:test';

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'autocache-mcp-corrupt-'));
process.env.AUTOCACHE_HOME = home;
process.env.AUTOCACHE_STORE_SCOPE = 'corrupt-test';
process.env.AUTOCACHE_SCOPE = 'corrupt-test';

const { actions } = await import('../src/operations.js');
const scoped = (...parts) => path.join(home, 'stores', 'corrupt-test', ...parts);
const corrupt = (relParts, content = '{broken-json') => {
  const file = scoped(...relParts);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content, 'utf8');
  return file;
};

after(() => fs.rmSync(home, { recursive: true, force: true }));

test('breadcrumb mutations fail closed on a corrupt active.json', () => {
  const activeFile = corrupt(['breadcrumbs', 'active.json']);
  for (const call of [
    () => actions.breadcrumbStart({ name: 'must not land' }),
    () => actions.breadcrumbStep({ milestone: 'must not land' }),
    () => actions.breadcrumbComplete({ outcome: 'must not land' }),
    () => actions.breadcrumbAbort({ reason: 'must not land' })
  ]) {
    assert.throws(call, /not valid JSON.*no write was made/);
  }
  assert.equal(fs.readFileSync(activeFile, 'utf8'), '{broken-json');
});

test('status surfaces a corrupt active.json instead of reporting no breadcrumb silently', () => {
  const status = actions.status();
  assert.equal(status.ok, true);
  assert.equal(status.active_breadcrumb, null);
  assert.ok(status.problems.some((p) => p.includes('breadcrumbs/active.json')));
});

test('resume surfaces a corrupt active.json and a damaged newest checkpoint', () => {
  corrupt(['checkpoints', 'zzz-newest.json']);
  const resume = actions.resume();
  assert.equal(resume.ok, true);
  assert.equal(resume.latest_checkpoint, null);
  assert.ok(resume.problems.some((p) => p.includes('breadcrumbs/active.json')));
  assert.ok(resume.problems.some((p) => p.includes('checkpoints/zzz-newest.json')));
});

test('checkpoint still writes but surfaces what it could not embed', () => {
  const result = actions.checkpoint({ label: 'recovery', summary: 'save despite damage' });
  assert.equal(result.ok, true);
  assert.equal(result.checkpoint.breadcrumb_id, null);
  assert.ok(fs.existsSync(result.path));
  assert.ok(result.problems.some((p) => p.includes('breadcrumbs/active.json')
    && p.includes('breadcrumb_id was recorded as null')));
});

test('handoff names a present-but-damaged session record', () => {
  fs.mkdirSync(scoped('sessions'), { recursive: true });
  fs.writeFileSync(scoped('sessions', 'index.json'), JSON.stringify(['sess-damaged']), 'utf8');
  corrupt(['sessions', 'sess-damaged.json']);
  const result = actions.handoff({ title: 'handoff despite damage' });
  assert.equal(result.ok, true);
  assert.equal(result.session_updated, false);
  assert.ok(result.problems.some((p) => p.includes('sessions/sess-damaged.json')
    && p.includes('was not updated')));
});

test('an absent active.json is NOT corruption: mutations work once the damage is removed', () => {
  fs.rmSync(scoped('breadcrumbs', 'active.json'));
  const started = actions.breadcrumbStart({ name: 'clean start | targets: none' });
  assert.equal(started.ok, true);
  const completed = actions.breadcrumbComplete({ outcome: 'clean finish' });
  assert.equal(completed.ok, true);
});
