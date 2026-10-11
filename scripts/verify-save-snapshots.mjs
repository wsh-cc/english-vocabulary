import assert from 'node:assert/strict';
import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { build } from 'esbuild';

// Runs actual handlers against in-memory SQLite. No cookies, credentials,
// user database, preview server, or external requests are used.
const baseline = process.argv.includes('--baseline');
const db = new DatabaseSync(':memory:');
for (const file of fs.readdirSync('drizzle').filter(file => file.endsWith('.sql')).sort()) {
  db.exec(fs.readFileSync('drizzle/' + file, 'utf8'));
}
const d1 = {
  prepare(sql) {
    const statement = db.prepare(sql);
    let values = [];
    return {
      bind(...args) { values = args; return this; },
      async first() { return statement.get(...values) ?? null; },
      async run() { return { meta: { changes: Number(statement.run(...values).changes) } }; },
    };
  },
};
globalThis.saveSnapshotTestEnv = { DB: d1 };
globalThis.saveSnapshotTestAccount = { userId: 'snapshot-owner', name: 'Synthetic learner' };
const originalFetch = globalThis.fetch;
globalThis.fetch = () => { throw Error('This verification must not make network requests.'); };

try {
  const bundled = await build({
    stdin: {
      contents: "export * as stateApi from './app/api/state/route'; export * as passagesApi from './app/api/passages/route'; export { initialState, seedWords } from './lib/learning';",
      resolveDir: process.cwd(),
      sourcefile: 'save-snapshot-verification.ts',
      loader: 'ts',
    },
    bundle: true, platform: 'node', format: 'esm', write: false,
    plugins: [{
      name: 'memory-only-save-snapshots',
      setup(builder) {
        builder.onResolve({ filter: /^(cloudflare:workers|@\/lib\/auth)$/ }, args => ({ path: args.path, namespace: 'save-snapshot-test' }));
        builder.onLoad({ filter: /.*/, namespace: 'save-snapshot-test' }, args => ({
          contents: args.path === 'cloudflare:workers'
            ? 'export const env = globalThis.saveSnapshotTestEnv;'
            : 'export const getAccount = async () => globalThis.saveSnapshotTestAccount; export const validWriteOrigin = request => request.headers.get("origin") === new URL(request.url).origin;',
        }));
      },
    }],
  });
  const { stateApi, passagesApi, initialState, seedWords } = await import('data:text/javascript;base64,' + Buffer.from(bundled.outputFiles[0].text).toString('base64'));
  const state = initialState();
  const wordId = seedWords[0].id;
  const now = 1791660000000;
  state.events = Array.from({ length: 1000 }, (_, index) => ({
    id: 'synthetic-' + index, wordId, mode: 'meaning', outcome: 'correct',
    at: now + index * 1000, delayed: false, answer: '', nextDue: now + 86400000 + index * 1000,
  }));
  db.prepare('INSERT INTO learner_state (user_id, payload, revision, updated_at) VALUES (?, ?, ?, ?)')
    .run('snapshot-owner', JSON.stringify(state), 1, now);

  const request = (api, body, tag) => new Request('http://snapshot.test/api/' + api, {
    ...(body ? { method: 'POST', body: JSON.stringify(body) } : {}),
    headers: { Origin: 'http://snapshot.test', 'Content-Type': 'application/json', ...(tag ? { 'If-None-Match': tag } : {}) },
  });
  const read = async response => {
    const text = await response.text();
    return { status: response.status, tag: response.headers.get('etag'), bytes: Buffer.byteLength(text), body: text ? JSON.parse(text) : null };
  };
  const getState = tag => stateApi.GET(request('state', null, tag)).then(read);
  const failures = [];
  const expect = (condition, message) => { if (!condition) failures.push(message); };
  const first = await getState();
  assert.equal(first.status, 200);
  assert.ok(first.tag);
  const unchanged = await getState(first.tag);
  assert.equal(unchanged.status, 304);
  assert.equal(unchanged.bytes, 0);

  const action = { type: 'note', wordId, note: 'Only an in-memory synthetic note.', operationId: crypto.randomUUID() };
  const saved = await read(await stateApi.POST(request('state', action)));
  assert.equal(saved.status, 200);
  assert.equal(saved.body.revision, first.body.revision + 1);
  assert.equal(saved.body.state.notes[wordId], action.note);
  const repeatedOrdinaryGet = await getState(first.tag);
  assert.equal(repeatedOrdinaryGet.status, 200);
  expect(!!saved.tag, 'POST /api/state must return the ETag for its returned state/revision.');
  expect(saved.tag === repeatedOrdinaryGet.tag, 'State save ETag must match an authenticated GET for the same revision.');
  const afterSavedTag = await getState(saved.tag);
  expect(afterSavedTag.status === 304 && afterSavedTag.bytes === 0, 'The next unchanged GET using the save ETag must be an empty 304.');
  const retriedSave = await read(await stateApi.POST(request('state', action)));
  assert.equal(retriedSave.status, 200);
  assert.equal(retriedSave.body.revision, saved.body.revision);
  expect(retriedSave.tag === repeatedOrdinaryGet.tag, 'An idempotent state retry must return the current revision ETag.');

  const opened = await read(await passagesApi.GET(request('passages')));
  assert.equal(opened.status, 200);
  const completion = { action: 'complete', id: opened.body.passage.id, operationId: crypto.randomUUID() };
  const completed = await read(await passagesApi.POST(request('passages', completion)));
  assert.equal(completed.status, 200);
  assert.equal(completed.body.revision, saved.body.revision + 1);
  assert.ok(completed.body.state.reading.completed[completion.id]);
  const repeatedReadingGet = await getState(repeatedOrdinaryGet.tag);
  assert.equal(repeatedReadingGet.status, 200);
  expect(!!completed.tag, 'POST /api/passages complete must return the ETag for its snapshot.');
  expect(completed.tag === repeatedReadingGet.tag, 'Reading save ETag must match a state GET for the same revision.');
  const afterReadingTag = await getState(completed.tag);
  expect(afterReadingTag.status === 304 && afterReadingTag.bytes === 0, 'The next unchanged GET after reading completion must be an empty 304.');
  const retriedCompletion = await read(await passagesApi.POST(request('passages', completion)));
  assert.equal(retriedCompletion.status, 200);
  assert.equal(retriedCompletion.body.revision, completed.body.revision);
  assert.equal(retriedCompletion.body.state.reading.encounters[opened.body.passage.wordIds[0]].count, 1);
  expect(retriedCompletion.tag === repeatedReadingGet.tag, 'An idempotent reading retry must return the current revision ETag.');

  globalThis.saveSnapshotTestAccount = null;
  assert.equal((await getState(repeatedReadingGet.tag)).status, 401, 'A matching validator must never bypass authentication.');
  globalThis.saveSnapshotTestAccount = { userId: 'snapshot-other', name: 'Other synthetic learner' };
  const other = await getState(repeatedReadingGet.tag);
  assert.equal(other.status, 200);
  assert.deepEqual(other.body.state.notes, {});
  assert.notEqual(other.tag, repeatedReadingGet.tag);

  console.log(JSON.stringify({
    mode: baseline ? 'baseline' : 'optimized-contract', data: '1000 synthetic events in memory',
    ordinary: { saveBytes: saved.bytes, legacyFollowupGetBytes: repeatedOrdinaryGet.bytes, saveTagPresent: !!saved.tag, savedTagNextStatus: afterSavedTag.status },
    reading: { saveBytes: completed.bytes, legacyFollowupGetBytes: repeatedReadingGet.bytes, saveTagPresent: !!completed.tag, savedTagNextStatus: afterReadingTag.status },
    avoidableLegacyFullStateBytes: repeatedOrdinaryGet.bytes + repeatedReadingGet.bytes,
    pendingContractFailures: failures,
  }, null, 2));
  if (!baseline) assert.deepEqual(failures, [], 'Saved snapshots must carry reusable, account-scoped validators.');
  console.log(baseline ? 'PASS: baseline measured; missing snapshot validators are listed above. No application changes.' : 'PASS: snapshot validators, empty conditional refreshes, idempotent retry and account isolation. In-memory handlers only.');
} finally {
  globalThis.fetch = originalFetch;
  delete globalThis.saveSnapshotTestEnv;
  delete globalThis.saveSnapshotTestAccount;
  db.close();
}
