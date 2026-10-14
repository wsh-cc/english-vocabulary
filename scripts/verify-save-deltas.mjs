import assert from 'node:assert/strict';
import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { gzipSync } from 'node:zlib';
import { build } from 'esbuild';
import { isolatedD1 } from './isolated-d1.mjs';

// Actual handlers and merge helpers, isolated SQLite, entirely synthetic data.
const db = new DatabaseSync(':memory:');
for (const file of fs.readdirSync('drizzle').filter(file => file.endsWith('.sql')).sort()) db.exec(fs.readFileSync('drizzle/' + file, 'utf8'));
let beforeWrite;
const d1 = isolatedD1(db, () => { const hook = beforeWrite; beforeWrite = null; hook?.(); });
globalThis.deltaTestEnv = { DB: d1 };
globalThis.deltaTestAccount = { userId: 'delta-owner', name: 'Synthetic learner' };
const originalFetch = globalThis.fetch;
globalThis.fetch = () => { throw Error('Network forbidden in delta verification.'); };
try {
  const bundled = await build({
    stdin: { contents: "export * as api from './app/api/state/route'; export { initialState, seedWords, availableModes, applyAction } from './lib/learning'; export { mergeSaveDelta } from './lib/save-delta'; export { stateSchema } from './lib/validation';", resolveDir: process.cwd(), loader: 'ts' },
    bundle: true, platform: 'node', format: 'esm', write: false,
    plugins: [{ name: 'memory-delta-handlers', setup(builder) {
      builder.onResolve({ filter: /^(cloudflare:workers|@\/lib\/auth)$/ }, args => ({ path: args.path, namespace: 'delta-test' }));
      builder.onLoad({ filter: /.*/, namespace: 'delta-test' }, args => ({
        contents: args.path === 'cloudflare:workers'
          ? 'export const env = globalThis.deltaTestEnv;'
          : 'export const getAccount = async () => globalThis.deltaTestAccount; export const validWriteOrigin = request => request.headers.get("origin") === new URL(request.url).origin;',
      }));
    } }],
  });
  const { api, initialState, seedWords, availableModes, applyAction, mergeSaveDelta, stateSchema } = await import('data:text/javascript;base64,' + Buffer.from(bundled.outputFiles[0].text).toString('base64'));
  const now = 1791660000000, wordId = seedWords[0].id;
  const seed = (state, revision = 1) => {
    db.prepare('DELETE FROM mobile_operations WHERE user_id = ?').run('delta-owner');
    db.prepare('DELETE FROM mobile_sync_meta WHERE user_id = ?').run('delta-owner');
    db.prepare('INSERT OR REPLACE INTO learner_state (user_id, payload, revision, updated_at) VALUES (?, ?, ?, ?)').run('delta-owner', JSON.stringify(state), revision, now);
  };
  const request = (body, base, extra = {}) => new Request('http://delta.test/api/state', {
    ...(body ? { method: 'POST', body: JSON.stringify(body) } : {}),
    headers: { Origin: 'http://delta.test', 'Content-Type': 'application/json', ...(base ? { 'X-Wordweave-Delta-Base': base } : {}), ...extra },
  });
  const read = async response => {
    const raw = await response.text();
    return { status: response.status, tag: response.headers.get('etag'), body: raw ? JSON.parse(raw) : null, bytes: Buffer.byteLength(raw), gzipBytes: gzipSync(raw).length };
  };
  const get = () => api.GET(request()).then(read);
  const post = (action, base) => api.POST(request(action, base)).then(read);
  const action = (type, other = {}) => ({ type, wordId, operationId: crypto.randomUUID(), ...other });
  const evidence = [];
  // 5000 plus all catalog tracks stays under D1's safe 1.9 MB UTF-8 row budget.
  // Oversized states are covered by verify-mobile-api instead of pretending
  // that in-memory SQLite's larger rows are deployable to D1.
  for (const count of [0, 1000, 5000]) {
    const state = initialState();
    state.operations = Array.from({ length: 1000 }, (_, i) => 'old-op-' + i);
    // Include realistic tracks for the catalog while leaving wordId new to
    // verify that a result initializes every available mode of that word.
    for (const word of seedWords.slice(1)) {
      state.learned[word.id] = now;
      state.progress[word.id] = Object.fromEntries(availableModes(word).map(mode => [mode, { due: now, streak: 1, attempts: 1, correct: 1, hinted: 0, wrong: 0, last: now - 172800000, interval: 86400000 }]));
    }
    state.events = Array.from({ length: count }, (_, i) => ({ id: 'synthetic-' + i, wordId: seedWords[i % seedWords.length].id, mode: 'meaning', outcome: 'correct', at: now + i, delayed: false, answer: '合成答案', nextDue: now + 86400000 }));
    assert.ok(stateSchema.safeParse(state).success);
    seed(state);
    let current = await get();
    for (const item of [
      action('note', { note: '中文联想 with English' }),
      action('note', { note: '' }),
      ...['correct', 'hinted', 'wrong'].map(outcome => action('result', { mode: 'meaning', outcome, answer: '合成答案' })),
      action('result', { mode: 'recall', outcome: 'correct', answer: 'another mode' }),
    ]) {
      const old = current.body.state, original = JSON.stringify(old);
      const saved = await post(item, current.tag);
      assert.equal(saved.status, 200);
      assert.equal(saved.body.kind, 'save-delta-v1');
      const merged = mergeSaveDelta(old, current.body.revision, saved.body);
      const full = await get();
      assert.deepEqual(merged, full.body.state, 'delta must reproduce the exact authoritative state');
      assert.equal(JSON.stringify(old), original, 'merge must never mutate the previous snapshot');
      assert.equal(merged.custom, old.custom);
      assert.equal(merged.settings, old.settings);
      assert.equal(merged.reading, old.reading);
      assert.equal(merged.familiar, old.familiar);
      if (item.type === 'note') {
        assert.equal(merged.events, old.events);
        assert.equal(merged.progress, old.progress);
        assert.equal(merged.learned, old.learned);
      } else {
        assert.equal(merged.progress[seedWords[1].id], old.progress[seedWords[1].id]);
        assert.deepEqual(Object.keys(merged.progress[wordId]), availableModes(seedWords[0]));
        assert.equal(merged.events.length, old.events.length + 1);
      }
      assert.equal(merged.operations.length, 1000);
      assert.equal(merged.operations.at(-1), item.operationId);
      assert.equal(mergeSaveDelta(old, current.body.revision + 2, saved.body), null);
      assert.equal(mergeSaveDelta({ ...old, events: [...old.events, {}] }, current.body.revision, saved.body), null);
      assert.equal((await api.GET(request(null, null, { 'If-None-Match': saved.tag }))).status, 304);
      // Lost response / repeated operation: must return a full state without a
      // second event, including when the client sends the already saved ETag.
      const retry = await post(item, current.tag);
      const retryCurrent = await post(item, saved.tag);
      assert.deepEqual(retry.body.state, merged);
      assert.deepEqual(retryCurrent.body.state, merged);
      assert.equal(retry.body.revision, saved.body.revision);
      evidence.push({ events: count, action: item.type, outcome: item.outcome ?? '', fullBytes: full.bytes, deltaBytes: saved.bytes, fullGzipBytes: full.gzipBytes, deltaGzipBytes: saved.gzipBytes });
      current = full;
    }
  }

  seed(initialState());
  let base = await get();
  const noOptIn = await post(action('note', { note: 'legacy client' }));
  assert.ok(noOptIn.body.state, 'older clients must receive full snapshots');
  const external = action('note', { note: 'other device', wordId: seedWords[1].id });
  await post(external);
  const stale = await post(action('result', { mode: 'meaning', outcome: 'correct', answer: '' }), base.tag);
  assert.ok(stale.body.state);
  assert.equal(stale.body.state.notes[external.wordId], external.note, 'stale base must include other-device updates');

  base = await get();
  const settings = await post(action('settings', { settings: { daily: 8 } }), base.tag);
  assert.ok(settings.body.state, 'unsupported delta action uses a full snapshot');
  const backup = structuredClone(settings.body.state);
  const restored = await post(action('restore', { backup, revision: settings.body.revision }), settings.tag);
  assert.ok(restored.body.state, 'restore retains its full-state contract');

  // Force a real CAS miss between read and write, committing another device's
  // note before the handler retries the original operation.
  seed(initialState());
  base = await get();
  beforeWrite = () => {
    const state = initialState();
    applyAction(state, external, now);
    seed(state, 2);
  };
  const raced = await post(action('result', { mode: 'meaning', outcome: 'wrong', answer: '' }), base.tag);
  assert.ok(raced.body.state, 'successful retry with a different base must return full state');
  assert.equal(raced.body.revision, 3);
  assert.equal(raced.body.state.notes[external.wordId], external.note);
  assert.equal(raced.body.state.events.length, 1);

  // Concurrent writes start from one common snapshot and retain both edits.
  seed(initialState()); base = await get();
  const concurrent = await Promise.all([post(action('note', { note: 'one' }), base.tag), post(action('note', { wordId: seedWords[1].id, note: 'two' }), base.tag)]);
  assert.equal(concurrent.filter(result => result.body.kind === 'save-delta-v1').length, 1);
  assert.equal(concurrent.filter(result => !!result.body.state).length, 1);
  assert.equal((await get()).body.revision, 3);

  const otherTag = '"wordweave-other-3"';
  const wrongAccount = await post(action('note', { note: 'isolated' }), otherTag);
  assert.ok(wrongAccount.body.state, 'another account validator cannot negotiate a delta');
  globalThis.deltaTestAccount = null;
  assert.equal((await api.POST(request(action('note', { note: '' }), wrongAccount.tag))).status, 401);
  globalThis.deltaTestAccount = { userId: 'other', name: 'Other learner' };
  const other = await post(action('note', { note: 'other account' }), wrongAccount.tag);
  assert.ok(other.body.state);
  assert.equal(other.body.revision, 1);
  assert.equal(other.body.state.events.length, 0);
  assert.equal((await api.POST(request(action('note', { note: '' }), null, { Origin: 'http://invalid.test' }))).status, 403);

  fs.mkdirSync('.sites-runtime/flow', { recursive: true });
  fs.writeFileSync('.sites-runtime/flow/save-delta-contract.json', JSON.stringify({ pass: true, evidence }, null, 2));
  console.log(JSON.stringify({ pass: true, cases: '0/1000/5000 records under D1 byte limit; exact full-state equivalence; untouched references; operation window; all outcomes; fresh word modes; retries; stale base; CAS race; concurrent writes; restore; legacy clients; authentication; account isolation', representative: evidence.filter(row => row.action === 'result' && row.outcome === 'correct') }, null, 2));
} finally {
  globalThis.fetch = originalFetch;
  delete globalThis.deltaTestEnv;
  delete globalThis.deltaTestAccount;
  db.close();
}
