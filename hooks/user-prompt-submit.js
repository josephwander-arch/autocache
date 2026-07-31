'use strict';
/**
 * Autocache UserPromptSubmit hook.
 *
 * Token-matches the prompt against findings recorded in prior sessions and
 * surfaces at most the top 2, each with its session id and date.
 *
 * Prompts under 4 words are skipped entirely - short prompts are commands
 * ("go on", "fix it"), not topic queries, and matching them produces noise.
 *
 * Fails open: any error exits 0 silently.
 */

const STOPWORDS = new Set([
  'the', 'and', 'for', 'that', 'this', 'with', 'you', 'your', 'are', 'was', 'were',
  'can', 'have', 'has', 'had', 'not', 'but', 'from', 'into', 'what', 'when', 'where',
  'which', 'how', 'why', 'who', 'get', 'got', 'let', 'lets', 'its', 'our', 'their',
  'there', 'here', 'then', 'than', 'them', 'they', 'she', 'him', 'her', 'his',
  'about', 'all', 'any', 'also', 'just', 'now', 'out', 'over', 'some', 'such',
  'only', 'own', 'same', 'too', 'very', 'will', 'would', 'should', 'could', 'been',
  'being', 'does', 'did', 'doing', 'done', 'make', 'made', 'need', 'want', 'use',
  'using', 'used', 'add', 'set', 'run', 'see', 'look', 'please', 'thanks'
]);

function tokenize(text) {
  const out = new Set();
  const raw = String(text || '').toLowerCase();
  const parts = raw.split(/[^a-z0-9_.\-/\\]+/);
  for (const p of parts) {
    if (!p) continue;
    // Split path-ish tokens into their segments too, keeping the whole token.
    const pieces = [p].concat(p.split(/[.\-/\\_]+/));
    for (const piece of pieces) {
      const t = piece.replace(/^[._-]+|[._-]+$/g, '');
      if (t.length < 3) continue;
      if (STOPWORDS.has(t)) continue;
      if (/^\d+$/.test(t)) continue;
      out.add(t);
    }
  }
  return out;
}

try {
  const store = require('./lib/store.js');
  const input = store.readStdinJSON();
  const cfg = store.config();

  if (cfg.enabled === false || cfg.quiet === true) process.exit(0);

  const prompt = typeof input.prompt === 'string' ? input.prompt
    : (typeof input.user_prompt === 'string' ? input.user_prompt : '');

  const words = prompt.trim().split(/\s+/).filter(Boolean);
  if (words.length < 4) process.exit(0);

  const promptTokens = tokenize(prompt);
  if (promptTokens.size < 2) process.exit(0);

  const all = store.findings();
  if (!all.length) process.exit(0);

  const scored = [];
  for (let i = 0; i < all.length; i++) {
    const f = all[i];
    const ftokens = tokenize(f.text);
    if (!ftokens.size) continue;
    let score = 0;
    let shared = 0;
    for (const t of ftokens) {
      if (!promptTokens.has(t)) continue;
      shared += 1;
      score += t.length >= 8 ? 2 : 1;
    }
    if (shared < 2) continue;
    // Recency tiebreak: findings() returns newest sessions first.
    scored.push({ finding: f, score: score, order: i });
  }

  if (!scored.length) process.exit(0);

  scored.sort((a, b) => (b.score - a.score) || (a.order - b.order));
  const top = scored.slice(0, 2);

  const lines = ['Autocache - related findings from prior sessions:'];
  for (const s of top) {
    const f = s.finding;
    const stamp = [f.session_id || 'unknown', f.date || ''].filter(Boolean).join(', ');
    lines.push('  - ' + store.truncate(f.text, 260) + ' [' + stamp + ']');
  }

  store.appendEvent({
    event: 'prompt_match',
    session_id: input.session_id || '',
    matches: top.length,
    top_score: top[0].score
  });

  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'UserPromptSubmit',
      additionalContext: lines.join('\n')
    }
  }));
  process.exit(0);
} catch (e) {
  process.exit(0);
}
