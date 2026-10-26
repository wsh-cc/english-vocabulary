import assert from 'node:assert/strict';
import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { build } from 'esbuild';

// Real routes, auth, learning and SQL; no network, credentials or production DB.
const db = new DatabaseSync(':memory:');
for (const file of fs.readdirSync('drizzle').filter(file => file.endsWith('.sql')).sort()) db.exec(fs.readFileSync(`drizzle/${file}`, 'utf8'));
let failStateWrite = false;
let queryCount = 0;
let capturedQueries = null;
let forceOneRacePerOperation = false;
const racedOperations = new Set();
function countQuery(sql) { queryCount++; capturedQueries?.push(sql); }
function prepare(sql) {
  let values = [];
  const execute = () => {
    countQuery(sql);
    if (failStateWrite && sql.startsWith('UPDATE learner_state')) { failStateWrite = false; throw Error('Injected disk failure'); }
    return { meta: { changes: Number(db.prepare(sql).run(...values).changes) } };
  };
  return { sql, get values() { return values; }, bind(...args) { values = args; return this; }, async first() { countQuery(sql); return db.prepare(sql).get(...values) ?? null; }, async all() { countQuery(sql); return { results: db.prepare(sql).all(...values) }; }, async run() { return execute(); }, execute };
}
const d1 = { prepare, async batch(statements) {
  if (forceOneRacePerOperation && statements.some(s => s.sql.startsWith('UPDATE learner_state'))) {
    const receipt = statements.find(s => s.sql.startsWith('INSERT OR IGNORE INTO mobile_operations'));
    if (receipt && !racedOperations.has(receipt.values[1])) {
      racedOperations.add(receipt.values[1]);
      db.prepare('UPDATE learner_state SET revision = revision + 1 WHERE user_id = ?').run(receipt.values[0]);
    }
  }
  db.exec('BEGIN');
  try { const results = statements.map(statement => statement.execute()); db.exec('COMMIT'); return results; }
  catch (error) { db.exec('ROLLBACK'); throw error; }
} };
globalThis.mobileTestEnv = { DB: d1, PASSWORD_PEPPER: 'synthetic-mobile-test-pepper', REGISTRATION_KEY_HASH: 'synthetic' };
globalThis.mobileTestWebAccount = { userId: 'synthetic-owner', name: 'Tester' };
const originalFetch = globalThis.fetch, originalNow = Date.now;
globalThis.fetch = () => { throw Error('Network forbidden in mobile API verification.'); };
let clock = 1791800000000;
Date.now = () => clock;
try {
  const bundled = await build({
    stdin: { contents: "export * as auth from './app/api/mobile/auth/route'; export * as bootstrap from './app/api/mobile/bootstrap/route'; export * as version from './app/api/mobile/version/route'; export * as sync from './app/api/mobile/sync/route'; export * as restore from './app/api/mobile/restore/route'; export * as web from './app/api/state/route'; export * as ledger from './db/mobile-sync'; export { initialState, seedWords, applyAction, DAY } from './lib/learning'; export { readingPassages } from './lib/curriculum'; export { passwordHash, digest } from './lib/auth-crypto'; export { mergeSaveDelta } from './lib/save-delta'; export { MOBILE_CONTENT_VERSION, MOBILE_STATE_MAX_BYTES, MOBILE_SYNC_BATCH_SIZE } from './lib/mobile-protocol';", resolveDir: process.cwd(), loader: 'ts' },
    bundle: true, platform: 'node', format: 'esm', write: false,
    plugins: [{ name: 'isolated-mobile-handlers', setup(builder) {
      builder.onResolve({ filter: /^(cloudflare:workers|@\/lib\/auth)$/ }, args => ({ path: args.path, namespace: 'mobile-test' }));
      builder.onLoad({ filter: /.*/, namespace: 'mobile-test' }, args => ({ contents: args.path === 'cloudflare:workers' ? 'export const env = globalThis.mobileTestEnv;' : 'export const getAccount = async () => globalThis.mobileTestWebAccount; export const validWriteOrigin = request => request.headers.get("origin") === new URL(request.url).origin && request.headers.get("sec-fetch-site") !== "cross-site" && request.headers.get("content-type")?.startsWith("application/json");' }));
    } }],
  });
  const api = await import('data:text/javascript;base64,' + Buffer.from(bundled.outputFiles[0].text).toString('base64'));
  const { initialState, seedWords, DAY } = api;
  const userId = 'synthetic-owner', password = 'SyntheticOnlyPassword-123';
  db.prepare('INSERT INTO app_accounts (slot,user_id,username,username_normalized,password_hash,salt,created_at) VALUES (?,?,?,?,?,?,?)').run('owner', userId, 'Tester', 'tester', await api.passwordHash(password, 'salt', globalThis.mobileTestEnv.PASSWORD_PEPPER), 'salt', clock);
  const request = (path, body, token, extra = {}) => new Request(`https://mobile.test/api/${path}`, { ...(body === undefined ? {} : { method: 'POST', body: JSON.stringify(body) }), headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...extra } });
  const read = async response => ({ status: response.status, body: await response.json(), tag: response.headers.get('etag') });
  const login = async deviceId => {
    const response = await api.auth.POST(request('mobile/auth', { action: 'login', username: 'Tester', password, deviceId })).then(read);
    assert.equal(response.status, 200); assert.equal(response.body.user.userId, userId); return response.body.token;
  };
  const tokenA = await login('device-a'), tokenB = await login('device-b');
  const boot = token => api.bootstrap.GET(request('mobile/bootstrap', undefined, token)).then(read);
  const versionQueryCounts = [];
  const version = async (token, extra = {}) => {
    const changesBefore = db.prepare('SELECT total_changes() AS n').get().n;
    capturedQueries = []; queryCount = 0;
    try {
      const result = await api.version.GET(request('mobile/version', undefined, token, extra));
      assert.equal(result.headers.get('cache-control'), 'no-store');
      const response = await read(result);
      assert.ok(capturedQueries.every(sql => /^SELECT\b/i.test(sql)), 'version probe never writes or initializes state');
      assert.ok(capturedQueries.every(sql => !/\b(?:payload|baseline_payload)\b|SELECT\s+(?:\w+\.)?\*/i.test(sql)), 'version probe never selects a snapshot');
      assert.equal(db.prepare('SELECT total_changes() AS n').get().n, changesBefore);
      assert.ok(queryCount <= 2, `version probe used ${queryCount} queries`);
      if (response.status === 200) {
        assert.equal(queryCount, 2, 'one identity query and one version query');
        assert.deepEqual(Object.keys(response.body).sort(), ['contentVersion', 'generation', 'protocolVersion', 'revision', 'serverTime', 'user']);
        assert.equal(response.body.contentVersion, api.MOBILE_CONTENT_VERSION);
        assert.equal(response.body.protocolVersion, 1);
        assert.equal(response.body.serverTime, clock);
        assert.ok(Buffer.byteLength(JSON.stringify(response.body)) < 1024, 'version response stays small');
      }
      versionQueryCounts.push(queryCount);
      return response;
    } finally { capturedQueries = null; }
  };
  const requestQueryCounts = [];
  const sync = async (operations, token = tokenA) => {
    queryCount = 0;
    const response = await api.sync.POST(request('mobile/sync', { operations }, token)).then(read);
    assert.ok(queryCount <= 50, `D1 free-tier request query limit exceeded: ${queryCount}`);
    requestQueryCounts.push(queryCount);
    return response;
  };
  const web = async action => api.web.POST(request('state', { operationId: crypto.randomUUID(), ...action }, undefined, { Origin: 'https://mobile.test' })).then(read);
  let sequenceA = 0, sequenceB = 0;
  const operation = (action, options = {}) => ({ operationId: crypto.randomUUID(), deviceId: 'device-a', deviceSequence: ++sequenceA, occurredAt: clock, generation: 1, action, ...options });
  const operationB = (action, options = {}) => operation(action, { deviceId: 'device-b', deviceSequence: ++sequenceB, ...options });
  assert.equal((await version()).status, 401);
  assert.equal((await version(undefined, { Cookie: 'wordweave_session=fake' })).status, 401, 'cookie never authenticates a version probe');
  const uninitialized = await version(tokenA);
  assert.equal(uninitialized.status, 200); assert.equal(uninitialized.body.revision, 0); assert.equal(uninitialized.body.generation, 1);
  assert.deepEqual(uninitialized.body.user, { userId, name: 'Tester' });
  assert.deepEqual((await version(tokenB)).body, uninitialized.body, 'both devices observe the same account version');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM learner_state').get().n, 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM mobile_sync_meta').get().n, 0);
  const legacyVersionUser = 'version-without-mobile-metadata';
  db.prepare('INSERT INTO learner_state(user_id,payload,revision,updated_at) VALUES(?,?,?,?)').run(legacyVersionUser, JSON.stringify(initialState()), 7, clock);
  assert.deepEqual({ ...await api.ledger.readMobileVersion(legacyVersionUser) }, { revision: 7, generation: 1 });
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM mobile_sync_meta WHERE user_id = ?').get(legacyVersionUser).n, 0, 'legacy version lookup does not initialize metadata');
  const first = await boot(tokenA);
  assert.equal(first.status, 200); assert.equal(first.body.generation, 1); assert.equal(first.body.protocolVersion, 1);
  assert.equal(first.body.contentVersion, api.MOBILE_CONTENT_VERSION);
  assert.equal((await boot()).status, 401);
  assert.equal((await api.bootstrap.GET(request('mobile/bootstrap', undefined, undefined, { Cookie: 'wordweave_session=fake' })).then(read)).status, 401, 'cookie never authenticates mobile API');
  assert.equal((await api.auth.POST(request('mobile/auth', { action: 'register', username: 'NewUser', password, deviceId: 'device-a' })).then(read)).status, 400);
  assert.equal((await sync([operationB({ type: 'settings', settings: { daily: 8 } })])).status, 403);

  const wordId = seedWords[0].id, started = clock;
  const familiar = operation({ type: 'familiar', wordId, value: 'familiar' }, { occurredAt: started + 1000 });
  const introduce = operation({ type: 'introduce', ids: [wordId] }, { occurredAt: started + DAY });
  const older = operation({ type: 'result', wordId, mode: 'meaning', outcome: 'correct', answer: 'old' }, { occurredAt: started + 2 * DAY });
  const newer = operation({ type: 'result', wordId, mode: 'meaning', outcome: 'correct', answer: 'new' }, { occurredAt: started + 4 * DAY });
  clock = started + 4 * DAY;
  const firstMobileSave = await sync([newer]);
  assert.deepEqual(firstMobileSave.body.accepted, [newer.operationId]);
  const afterMobileVersion = await version(tokenB);
  assert.equal(afterMobileVersion.body.revision, firstMobileSave.body.revision);
  assert.ok(afterMobileVersion.body.revision > first.body.revision, 'mobile writes advance the visible version');
  assert.deepEqual((await version(tokenA)).body, afterMobileVersion.body);
  let response = await sync([familiar, introduce, older]);
  assert.equal(response.body.conflicts.length, 0);
  const expected = initialState();
  for (const op of [familiar, introduce, older, newer]) api.applyAction(expected, { ...op.action, operationId: op.operationId }, op.occurredAt);
  assert.deepEqual(response.body.state.progress[wordId], expected.progress[wordId]);
  assert.equal(response.body.state.events.at(-1).at, newer.occurredAt);
  assert.equal(response.body.state.progress[wordId].meaning.streak, 2);
  const repeated = await sync([older]);
  assert.equal(repeated.body.revision, response.body.revision);
  assert.equal(repeated.body.state.events.length, 2);
  assert.equal((await sync([{ ...older, action: { ...older.action, outcome: 'wrong' } }])).body.conflicts[0].code, 'operation_mismatch');

  const noteA = operation({ type: 'note', wordId, note: '手机 A 联想' }, { baseNote: '' });
  const noteB = operationB({ type: 'note', wordId, note: '手机 B 联想' }, { baseNote: '' });
  assert.equal((await sync([noteA])).body.conflicts.length, 0);
  const conflict = (await sync([noteB], tokenB)).body.conflicts[0];
  assert.equal(conflict.code, 'note_conflict'); assert.equal(conflict.local, '手机 B 联想'); assert.equal(conflict.remote, '手机 A 联想');
  assert.deepEqual((await sync([noteB], tokenB)).body.conflicts[0], conflict);
  const resolved = operationB({ type: 'note', wordId, note: '两者合并' }, { baseNote: '手机 A 联想' });
  assert.equal((await sync([resolved], tokenB)).body.state.notes[wordId], '两者合并');

  const custom = { ...seedWords[0], id: 'custom-canonical', word: 'wordweavetest', meaning: '合成词义' };
  const beforeWebVersion = await version(tokenA);
  const webImport = await web({ type: 'import', words: [custom] });
  assert.equal(webImport.status, 200);
  assert.equal((await version(tokenB)).body.revision, webImport.body.revision);
  assert.ok(webImport.body.revision > beforeWebVersion.body.revision, 'website writes advance the mobile-visible version');
  const imported = operation({ type: 'import', words: [{ ...custom, id: 'custom-device' }] });
  const practiceCustom = operation({ type: 'result', wordId: 'custom-device', mode: 'meaning', outcome: 'correct', answer: '' });
  response = await sync([imported, practiceCustom]);
  assert.equal(response.body.idMap['custom-device'], 'custom-canonical');
  assert.equal(response.body.conflicts.length, 0); assert.equal(response.body.state.custom.length, 1);
  assert.equal(response.body.state.events.at(-1).wordId, 'custom-canonical');
  const laterAlias = operation({ type: 'note', wordId: 'custom-device', note: '跨批次原始编号' }, { baseNote: '' });
  const aliasWire = JSON.stringify(laterAlias);
  const laterAliasResult = await sync([laterAlias]);
  assert.equal(laterAliasResult.body.state.notes['custom-canonical'], '跨批次原始编号');
  assert.deepEqual((await sync([JSON.parse(aliasWire)])).body.accepted, [laterAlias.operationId], 'raw alias payload retries after a lost response');
  const aliasConflict = operation({ type: 'note', wordId: 'custom-device', note: '另一份联想' }, { baseNote: '' });
  assert.equal((await sync([aliasConflict])).body.conflicts[0].wordId, 'custom-canonical');
  const badImport = operation({ type: 'import', words: [{ ...custom, meaning: '不同义项' }] });
  assert.equal((await sync([badImport])).body.conflicts[0].code, 'word_id_conflict');

  const cet6 = api.readingPassages.find(p => p.level === 'CET6');
  await web({ type: 'settings', settings: { level: 'CET4' } });
  const reading = operation({ type: 'reading-complete', passageId: cet6.id, contentVersion: api.MOBILE_CONTENT_VERSION });
  response = await sync([reading]);
  assert.equal(response.body.conflicts.length, 0); assert.ok(response.body.state.reading.completed[cet6.id]);
  assert.equal(response.body.state.settings.level, 'CET4');
  const readingAgain = operation({ ...reading.action });
  assert.deepEqual((await sync([readingAgain])).body.state.reading, response.body.state.reading);

  // An APK update must replay old offline completions without changing their
  // immutable request payload; appended CET4 passages use the new version.
  const legacyPassage = api.readingPassages.find(p => p.level === 'CET4' && !p.wordIds.some(id => id.startsWith('cet4-common-')));
  const expandedPassage = api.readingPassages.find(p => p.level === 'CET4' && p.wordIds.some(id => id.startsWith('cet4-common-')));
  assert.ok(legacyPassage && expandedPassage, 'both original and expanded CET4 readings remain available');
  const oldReading = operation({ type: 'reading-complete', passageId: legacyPassage.id, contentVersion: 'wordweave-2026-10-v1' }, { occurredAt: clock - 1000 });
  const oldReadingWire = JSON.stringify(oldReading);
  const oldReadingSaved = await sync([oldReading]);
  assert.deepEqual(oldReadingSaved.body.accepted, [oldReading.operationId]);
  assert.deepEqual(oldReadingSaved.body.conflicts, []);
  assert.equal(oldReadingSaved.body.contentVersion, api.MOBILE_CONTENT_VERSION);
  assert.equal(oldReadingSaved.body.state.reading.completed[legacyPassage.id], oldReading.occurredAt);
  assert.deepEqual(oldReadingSaved.body.state.reading.encounters[legacyPassage.wordIds[0]], { count: 1, last: oldReading.occurredAt });
  const oldReadingRetry = await sync([JSON.parse(oldReadingWire)]);
  assert.deepEqual(oldReadingRetry.body.accepted, [oldReading.operationId]);
  assert.equal(oldReadingRetry.body.revision, oldReadingSaved.body.revision);
  assert.deepEqual(oldReadingRetry.body.state.reading, oldReadingSaved.body.state.reading);
  const changedVersionRetry = await sync([{ ...oldReading, action: { ...oldReading.action, contentVersion: api.MOBILE_CONTENT_VERSION } }]);
  assert.equal(changedVersionRetry.body.conflicts[0].code, 'operation_mismatch');
  const expandedReading = operation({ type: 'reading-complete', passageId: expandedPassage.id, contentVersion: 'wordweave-2026-10-v2' });
  const expandedReadingSaved = await sync([expandedReading]);
  assert.deepEqual(expandedReadingSaved.body.accepted, [expandedReading.operationId]);
  assert.equal(expandedReadingSaved.body.state.reading.completed[expandedPassage.id], expandedReading.occurredAt);
  assert.ok(expandedReadingSaved.body.state.reading.encounters[expandedPassage.wordIds.find(id => id.startsWith('cet4-common-'))]);
  assert.deepEqual(expandedReadingSaved.body.state.events, oldReadingSaved.body.state.events, 'reading completions never create practice scores');
  const unknownVersion = operation({ type: 'reading-complete', passageId: expandedPassage.id, contentVersion: 'wordweave-unknown-content' });
  const unknownVersionResult = await sync([unknownVersion]);
  assert.deepEqual(unknownVersionResult.body.accepted, []);
  assert.equal(unknownVersionResult.body.conflicts[0].code, 'content_version');
  assert.equal(unknownVersionResult.body.revision, expandedReadingSaved.body.revision);
  assert.deepEqual(unknownVersionResult.body.state, expandedReadingSaved.body.state);

  const cet6Expansion = api.readingPassages.find(p => p.batch.startsWith('cet6-exam-'));
  assert.ok(cet6Expansion && cet6Expansion.wordIds.length === 25);
  const currentReading = operation({ type: 'reading-complete', passageId: cet6Expansion.id, contentVersion: api.MOBILE_CONTENT_VERSION });
  const currentReadingSaved = await sync([currentReading]);
  assert.deepEqual(currentReadingSaved.body.accepted, [currentReading.operationId]);
  assert.ok(cet6Expansion.wordIds.every(id => currentReadingSaved.body.state.reading.encounters[id]?.count === 1));
  assert.deepEqual(currentReadingSaved.body.state.events, expandedReadingSaved.body.state.events, 'new CET6 reading does not create practice scores');

  const beforeFailure = await boot(tokenA);
  const failing = operation({ type: 'result', wordId, mode: 'recall', outcome: 'wrong', answer: 'preserve' });
  failStateWrite = true;
  const originalError = console.error;
  try { console.error = () => {}; assert.equal((await sync([failing])).status, 503); }
  finally { console.error = originalError; }
  assert.equal((await boot(tokenA)).body.revision, beforeFailure.body.revision);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM mobile_operations WHERE operation_id = ?').get(failing.operationId).n, 0, 'failed transaction cannot leave a receipt');
  assert.deepEqual((await sync([failing])).body.accepted, [failing.operationId]);

  // Concurrent browser/mobile updates share CAS and durable receipts.
  const parallelA = operation({ type: 'note', wordId: seedWords[1].id, note: 'parallel mobile' }, { baseNote: '' });
  const parallel = await Promise.all([sync([parallelA]), web({ type: 'note', wordId: seedWords[2].id, note: 'parallel web' })]);
  assert.ok(parallel.every(x => x.status === 200));
  const combined = (await boot(tokenA)).body.state;
  assert.equal(combined.notes[seedWords[1].id], 'parallel mobile'); assert.equal(combined.notes[seedWords[2].id], 'parallel web');
  const webBefore = await api.web.GET(request('state')).then(read);
  const webAction = { type: 'result', operationId: crypto.randomUUID(), wordId, mode: 'context', outcome: 'correct', answer: '' };
  clock += 1000;
  const delta = await api.web.POST(request('state', webAction, undefined, { Origin: 'https://mobile.test', 'X-Wordweave-Delta-Base': webBefore.tag })).then(read);
  assert.equal(delta.body.kind, 'save-delta-v1');
  assert.deepEqual(api.mergeSaveDelta(webBefore.body.state, webBefore.body.revision, delta.body), (await boot(tokenA)).body.state);
  assert.equal((await api.web.POST(request('state', webAction, undefined, { Origin: 'https://evil.test' })).then(read)).status, 403);
  assert.equal((await web(webAction)).body.revision, delta.body.revision, 'website retry is durably deduplicated');

  forceOneRacePerOperation = true;
  const threePractice = Array.from({ length: api.MOBILE_SYNC_BATCH_SIZE }, (_, index) => operation({ type: 'result', wordId: seedWords[index].id, mode: 'meaning', outcome: 'correct', answer: 'CAS retry' }));
  const raced = await sync(threePractice);
  assert.equal(raced.body.accepted.length, 3); assert.equal(racedOperations.size, 3);
  const worstCaseQueries = queryCount;
  forceOneRacePerOperation = false;
  assert.equal((await sync(Array.from({ length: 4 }, () => operation({ type: 'settings', settings: { daily: 8 } })))).status, 400);
  for (let batch = 0; batch < 367; batch++) {
    const operations = Array.from({ length: api.MOBILE_SYNC_BATCH_SIZE }, (_, i) => operation({ type: 'settings', settings: { daily: 1 + i % 40 } }));
    const saved = await sync(operations); assert.equal(saved.status, 200); assert.equal(saved.body.accepted.length, 3);
  }
  const longOffline = await boot(tokenA);
  assert.equal(longOffline.body.state.operations.length, 1000);
  assert.equal((await sync([older])).body.revision, longOffline.body.revision, 'receipt survives more than 1000 later operations');
  assert.equal((await sync([older])).body.state.events.filter(e => e.id === older.operationId).length, 1);
  const future = operation({ type: 'settings', settings: { daily: 3 } }, { occurredAt: clock + DAY });
  assert.equal((await sync([future])).body.conflicts[0].code, 'clock_invalid');

  const pendingOld = operation({ type: 'note', wordId, note: 'old generation' }, { baseNote: '两者合并' });
  const backup = initialState(); delete backup.reading;
  const restoreRequest = { operationId: crypto.randomUUID(), revision: longOffline.body.revision, generation: 1, backup };
  const restored = await api.restore.POST(request('mobile/restore', restoreRequest, tokenA)).then(read);
  assert.equal(restored.status, 200); assert.equal(restored.body.generation, 2);
  const afterRestoreVersion = await version(tokenB);
  assert.equal(afterRestoreVersion.body.generation, restored.body.generation);
  assert.equal(afterRestoreVersion.body.revision, restored.body.revision);
  assert.ok(db.prepare('SELECT payload FROM mobile_recovery WHERE user_id = ?').get(userId).payload);
  assert.equal((await api.restore.POST(request('mobile/restore', restoreRequest, tokenA)).then(read)).body.revision, restored.body.revision);
  assert.equal((await sync([pendingOld])).body.conflicts[0].code, 'generation_changed');
  assert.equal((await api.restore.POST(request('mobile/restore', { ...restoreRequest, operationId: crypto.randomUUID() }, tokenA)).then(read)).status, 409);
  assert.equal((await api.restore.POST(request('mobile/restore', { ...restoreRequest, backup: { ...backup, version: 99 } }, tokenA)).then(read)).status, 400);
  const webRestore = await web({ type: 'restore', backup: initialState(), revision: restored.body.revision });
  assert.equal(webRestore.status, 200); assert.equal((await boot(tokenA)).body.generation, 3);
  assert.equal((await version(tokenA)).body.generation, 3, 'website restores also advance the observed generation');

  // Migration preserves full history. A retried baseline event must not be
  // replayed a second time when a later practice event rebuilds the schedule.
  const migratedUser = 'migration-fixture', migrated = initialState(), legacyId = crypto.randomUUID();
  const legacyAction = { type: 'result', operationId: legacyId, wordId, mode: 'meaning', outcome: 'correct', answer: 'legacy' };
  api.applyAction(migrated, legacyAction, clock - DAY);
  db.prepare('INSERT INTO learner_state(user_id,payload,revision,updated_at) VALUES(?,?,?,?)').run(migratedUser, JSON.stringify(migrated), 4, clock - DAY);
  db.exec(fs.readFileSync('drizzle/0002_mobile_sync.sql', 'utf8'));
  assert.deepEqual((await api.ledger.readMobileState(migratedUser)).state, migrated);
  const legacyOperation = { operationId: legacyId, deviceId: 'migration-device', deviceSequence: 1, occurredAt: clock - DAY, generation: 1, action: legacyAction };
  assert.equal((await api.ledger.applyMobileOperation(migratedUser, legacyOperation)).accepted, true);
  const afterLegacy = await api.ledger.applyMobileOperation(migratedUser, { ...legacyOperation, operationId: crypto.randomUUID(), deviceSequence: 2, occurredAt: clock, action: { ...legacyAction, operationId: undefined, answer: 'later' } });
  assert.equal(afterLegacy.state.events.length, 2);
  assert.equal(afterLegacy.state.events.filter(event => event.id === legacyId).length, 1);
  assert.equal(afterLegacy.state.progress[wordId].meaning.attempts, 2);

  const utf8Large = initialState();
  for (const word of seedWords.slice(0, 640)) utf8Large.notes[word.id] = '汉'.repeat(1000);
  const utf8Payload = JSON.stringify(utf8Large);
  assert.ok(utf8Payload.length < api.MOBILE_STATE_MAX_BYTES);
  assert.ok(Buffer.byteLength(utf8Payload) > api.MOBILE_STATE_MAX_BYTES);
  assert.ok(Buffer.byteLength(utf8Payload) < 2000000, 'pre-existing D1-compatible oversized fixture');
  const smallBefore = await api.ledger.readMobileState(migratedUser);
  await assert.rejects(api.ledger.restoreMobileState(migratedUser, crypto.randomUUID(), utf8Large, smallBefore.revision, smallBefore.generation), error => error.code === 'state_limit');
  assert.deepEqual((await api.ledger.readMobileState(migratedUser)).state, smallBefore.state);
  const duplicateBackup = structuredClone(smallBefore.state); duplicateBackup.events.push(duplicateBackup.events[0]);
  await assert.rejects(api.ledger.restoreMobileState(migratedUser, crypto.randomUUID(), duplicateBackup, smallBefore.revision, smallBefore.generation), error => error.code === 'duplicate_event');

  const largeValid = initialState();
  for (const word of seedWords.slice(0, 570)) largeValid.notes[word.id] = '汉'.repeat(1000);
  const largeSaved = await api.ledger.restoreMobileState(migratedUser, crypto.randomUUID(), largeValid, smallBefore.revision, smallBefore.generation);
  const largeAgain = await api.ledger.restoreMobileState(migratedUser, crypto.randomUUID(), largeValid, largeSaved.revision, largeSaved.generation);
  const baselineBytes = Buffer.byteLength(db.prepare('SELECT baseline_payload FROM mobile_sync_meta WHERE user_id = ?').get(migratedUser).baseline_payload);
  const recoveryBytes = Buffer.byteLength(db.prepare('SELECT payload FROM mobile_recovery WHERE user_id = ?').get(migratedUser).payload);
  assert.ok(baselineBytes < api.MOBILE_STATE_MAX_BYTES && recoveryBytes < api.MOBILE_STATE_MAX_BYTES);
  assert.ok(baselineBytes + recoveryBytes > 2000000, 'large baseline and recovery are stored in independent rows');
  const oldGeneration = await api.ledger.applyMobileOperation(migratedUser, { ...legacyOperation, operationId: crypto.randomUUID(), deviceSequence: 3, occurredAt: clock, generation: largeSaved.generation, action: { type: 'settings', settings: { daily: 8 } } });
  assert.equal(oldGeneration.conflict.code, 'generation_changed');
  assert.equal((await api.ledger.readMobileState(migratedUser)).generation, largeAgain.generation);

  // An older valid D1 row above the new safe write limit remains readable and
  // exportable in full. Neither migration nor failed writes truncate it.
  const oversizedUser = 'oversized-migration-fixture';
  db.prepare('INSERT INTO learner_state(user_id,payload,revision,updated_at) VALUES(?,?,?,?)').run(oversizedUser, utf8Payload, 1, clock);
  db.exec(fs.readFileSync('drizzle/0002_mobile_sync.sql', 'utf8'));
  assert.equal(JSON.stringify((await api.ledger.readMobileState(oversizedUser)).state), utf8Payload);
  const rejected = await api.ledger.applyMobileOperation(oversizedUser, { ...legacyOperation, operationId: crypto.randomUUID(), occurredAt: clock, action: { type: 'settings', settings: { daily: 8 } } });
  assert.equal(rejected.conflict.code, 'state_limit');
  assert.equal(db.prepare('SELECT payload FROM learner_state WHERE user_id = ?').get(oversizedUser).payload, utf8Payload);

  assert.equal((await api.auth.POST(request('mobile/auth', { action: 'logout' }, tokenA)).then(read)).status, 200);
  assert.equal((await boot(tokenA)).status, 401); assert.equal((await boot(tokenB)).status, 200);
  assert.equal((await version(tokenA)).status, 401); assert.equal((await version(tokenB)).status, 200);
  clock += 15 * DAY;
  assert.equal((await boot(tokenB)).status, 401); assert.ok(db.prepare('SELECT payload FROM learner_state WHERE user_id = ?').get(userId));
  assert.equal((await version(tokenB)).status, 401, 'expired bearer cannot probe account state');
  db.prepare('DELETE FROM auth_attempts').run();
  let limited;
  for (let i = 0; i < 11; i++) limited = await api.auth.POST(request('mobile/auth', { action: 'login', username: 'Tester', password: 'WrongPassword123', deviceId: 'device-a' })).then(read);
  assert.equal(limited.status, 429);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM mobile_sessions WHERE token_hash = ?').get(tokenA).n, 0, 'raw token never stored');
  console.log(JSON.stringify({ pass: true, maximumVersionQueries: Math.max(...versionQueryCounts), maximumSyncQueries: Math.max(...requestQueryCounts), threePracticeWithThreeCasRacesQueries: worstCaseQueries, cases: ['bearer-only auth and no registration', 'read-only version probes without snapshot reads or initialization', 'shared device version after web/mobile writes and restores', 'version probes reject missing, revoked and expired credentials', 'shared login rate limit', 'original-time deterministic practice replay', 'durable dedupe after 1101 writes', 'operation payload mismatch', 'note two-version conflicts', 'durable canonical aliases across batches and lost replies', 'reading after level switch', 'legacy offline reading replay with immutable retries and expanded CET4 content', 'unknown reading versions preserve account state', 'atomic rollback and retries', 'concurrent website/mobile writes', 'v1 save-delta and origin protection', 'restore generations and separate recovery rows', 'UTF8 state byte limit and no migration truncation', 'migrated baseline event dedupe', 'logout and expiry preserve learning records'] }, null, 2));
} finally {
  globalThis.fetch = originalFetch; Date.now = originalNow;
  delete globalThis.mobileTestEnv; delete globalThis.mobileTestWebAccount;
  db.close();
}
