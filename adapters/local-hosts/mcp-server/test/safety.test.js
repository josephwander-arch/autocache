import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { okResult } from '../src/results.js';

test('tool output is capped and remains valid JSON', () => {
  const result = okResult({ value: 'x'.repeat(50_000) });
  assert.equal(result.content[0].type, 'text');
  assert.ok(result.content[0].text.length <= 12_000);
  const parsed = JSON.parse(result.content[0].text);
  assert.equal(parsed.truncated, true);
  assert.ok(parsed.original_chars > 50_000);
});

test('reminder add refuses to overwrite malformed state', async (t) => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'autocache-mcp-safety-'));
  process.env.AUTOCACHE_HOME = home;
  process.env.AUTOCACHE_STORE_SCOPE = 'safety-test';
  process.env.AUTOCACHE_SCOPE = 'safety-test';

  const { actions } = await import('../src/operations.js');
  const reminderPath = path.join(home, 'stores', 'safety-test', 'reminders.json');
  fs.mkdirSync(path.dirname(reminderPath), { recursive: true });
  fs.writeFileSync(reminderPath, '{broken-json', 'utf8');

  t.after(() => fs.rmSync(home, { recursive: true, force: true }));

  assert.throws(
    () => actions.remindersAdd({ text: 'must not land' }),
    /not valid JSON/
  );
  assert.equal(fs.readFileSync(reminderPath, 'utf8'), '{broken-json');
});
