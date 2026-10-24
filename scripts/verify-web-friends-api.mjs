import assert from 'node:assert/strict';
import fs from 'node:fs';
import { AsyncLocalStorage } from 'node:async_hooks';
import { DatabaseSync } from 'node:sqlite';
import { build } from 'esbuild';

// Real website route, cookie authentication, friend services and migrations.
// Only the request cookie adapter and D1 transport are replaced; no real data.
const db = new DatabaseSync(':memory:');
db.exec('PRAGMA foreign_keys = ON');
for (const file of fs.readdirSync('drizzle').filter(file => file.endsWith('.sql')).sort()) db.exec(fs.readFileSync(`drizzle/${file}`, 'utf8'));
let failWrite = false;
function prepare(sql) {
  let values = [];
  const execute = () => {
    if (failWrite && sql.startsWith('UPDATE friend_links')) { failWrite = false; throw Error('Synthetic private storage detail'); }
    return { meta: { changes: Number(db.prepare(sql).run(...values).changes) } };
  };
  return { bind(...args) { values = args; return this; }, async first() { return db.prepare(sql).get(...values) ?? null; }, async all() { return { results: db.prepare(sql).all(...values) }; }, async run() { return execute(); }, execute };
}
globalThis.webFriendsTestEnv = { DB: { prepare, async batch(statements) {
  db.exec('BEGIN');
  try { const result = statements.map(statement => statement.execute()); db.exec('COMMIT'); return result; }
  catch (error) { db.exec('ROLLBACK'); throw error; }
} } };
globalThis.webFriendsCookies = new AsyncLocalStorage();
const originalFetch = globalThis.fetch, originalNow = Date.now;
globalThis.fetch = () => { throw Error('Network forbidden in web friends verification.'); };
const clock = 1792500000000;
Date.now = () => clock;
const cases = [];
try {
  const bundle = await build({
    stdin: { contents: "export * as friends from './app/api/friends/route'; export { digest } from './lib/auth-crypto'; export { initialState, seedWords } from './lib/learning'; export { readingPassages } from './lib/curriculum';", resolveDir: process.cwd(), loader: 'ts' },
    bundle: true, platform: 'node', format: 'esm', write: false,
    plugins: [{ name: 'isolated-web-friends', setup(builder) {
      builder.onResolve({ filter: /^(cloudflare:workers|next\/headers)$/ }, args => ({ path: args.path, namespace: 'web-friends-test' }));
      builder.onLoad({ filter: /.*/, namespace: 'web-friends-test' }, args => ({ contents: args.path === 'cloudflare:workers'
        ? 'export const env = globalThis.webFriendsTestEnv;'
        : 'export const cookies = async () => ({ get: name => { const value = globalThis.webFriendsCookies.getStore()?.get(name); return value ? { value } : undefined; } });' }));
    } }],
  });
  const api = await import('data:text/javascript;base64,' + Buffer.from(bundle.outputFiles[0].text).toString('base64'));
  async function account(id, name = id, expired = false) {
    const token = crypto.randomUUID().replaceAll('-', '') + crypto.randomUUID().replaceAll('-', '');
    db.prepare('INSERT INTO app_accounts(slot,user_id,username,username_normalized,password_hash,salt,created_at) VALUES(?,?,?,?,?,?,?)').run(id, id, name, name.toLowerCase(), 'unused-synthetic-hash', 'synthetic', clock);
    db.prepare('INSERT INTO app_sessions(token_hash,user_id,expires_at) VALUES(?,?,?)').run(await api.digest(token), id, expired ? clock - 1 : clock + 86400000);
    return token;
  }
  const alice = await account('alice', 'Alice'), bob = await account('bob', 'Bob'), eve = await account('eve', 'Eve');
  const request = (token, query = '', body, headers = {}) => new Request('https://friends.test/api/friends' + query, {
    ...(body === undefined ? {} : { method: 'POST', body: JSON.stringify(body) }),
    headers: { 'Content-Type': 'application/json', Origin: 'https://friends.test', ...(token ? { Cookie: `wordweave_session=${token}` } : {}), ...headers },
  });
  async function invoke(req, method = req.method) {
    const cookies = new Map((req.headers.get('cookie') ?? '').split(';').map(item => { const index = item.indexOf('='); return [item.slice(0, index).trim(), item.slice(index + 1).trim()]; }));
    const response = await globalThis.webFriendsCookies.run(cookies, () => api.friends[method](req));
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
    const result = { status: response.status, body: await response.json() };
    if (response.status >= 400) { assert.equal(typeof result.body.error, 'string'); assert.equal(typeof result.body.code, 'string'); }
    return result;
  }
  const get = (token, query = '', headers) => invoke(request(token, query, undefined, headers));
  const post = (token, body, headers) => invoke(request(token, '', body, headers));
  const detail = (token, userId) => get(token, '?view=detail&userId=' + userId);
  const search = (token, username) => get(token, '?view=search&username=' + encodeURIComponent(username));
  const check = name => cases.push(name);

  assert.equal((await get()).status, 401);
  assert.equal((await get(undefined, '?userId=alice', { Authorization: `Bearer ${alice}`, 'oai-authenticated-user-id': 'alice' })).status, 401);
  assert.equal((await get('invalid-cookie')).status, 401);
  assert.equal((await get(await account('expired', 'Expired', true))).status, 401);
  assert.equal((await post(undefined, { type: 'request', userId: 'bob' })).status, 401);
  assert.equal((await get(alice, '', { Authorization: `Bearer ${bob}` })).status, 200);
  check('website cookies only: missing, malformed and expired sessions rejected; bearer and identity spoofing ignored');

  for (const headers of [{ Origin: 'https://evil.test' }, { Origin: '' }, { 'sec-fetch-site': 'cross-site' }, { 'Content-Type': 'text/plain' }]) {
    assert.equal((await post(alice, { type: 'request', userId: 'bob' }, headers)).status, 403);
  }
  assert.equal(db.prepare('SELECT COUNT(*) n FROM friend_links').get().n, 0);
  check('cross-origin, missing-origin, cross-site and non-JSON writes cannot mutate relations');

  const profile = { nickname: 'Bob profile', signature: 'Visible to accepted friends', avatar: 'custom', avatarDataUrl: 'data:image/jpeg;base64,/9j/2Q==', shareLearning: false };
  assert.equal((await post(bob, { type: 'profile', profile })).status, 200);
  const [aliceList, bobList] = await Promise.all([get(alice, '?userId=bob'), get(bob, '?userId=alice')]);
  assert.equal(aliceList.body.published, false); assert.equal(aliceList.body.profile.nickname, '');
  assert.deepEqual(bobList.body.profile, profile); assert.equal(bobList.body.published, true);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM learner_state').get().n, 0);
  check('concurrent cookies keep account profiles isolated; query userId never selects the current account');

  const found = await search(alice, 'bOB');
  assert.equal(found.status, 200); assert.equal(found.body.user.userId, 'bob');
  assert.equal(found.body.user.nickname, ''); assert.equal(found.body.user.avatarDataUrl, undefined);
  assert.equal((await search(alice, 'Missing')).body.user, null);
  assert.equal((await search(alice, 'Bo')).status, 400);
  assert.equal((await detail(alice, 'bob')).status, 404);
  assert.equal((await get(alice, '?view=detail')).status, 400);
  assert.equal((await get(alice, '?view=unknown')).status, 400);
  check('exact username discovery exposes minimal identity; private details and invalid views are rejected');

  const sent = await post(alice, { type: 'request', userId: 'bob' }), requestId = sent.body.outgoing[0].requestId;
  assert.equal(sent.status, 200);
  assert.equal((await get(bob)).body.incoming[0].requestId, requestId);
  assert.equal((await post(alice, { type: 'accept', requestId })).status, 403);
  assert.equal((await post(eve, { type: 'accept', requestId })).status, 403);
  assert.equal((await post(bob, { type: 'accept', requestId })).status, 200);
  const friend = await detail(alice, 'bob');
  assert.equal(friend.body.user.nickname, profile.nickname); assert.equal(friend.body.user.avatarDataUrl, profile.avatarDataUrl);
  assert.equal(friend.body.stats, null);
  assert.equal((await detail(eve, 'bob')).status, 404);
  check('friend request and acceptance enforce direction and unlock only accepted friend profiles');

  const learning = api.initialState(), word = api.seedWords[0];
  learning.reading.completed[api.readingPassages[0].id] = clock;
  learning.reading.encounters[word.id] = { count: 1, last: clock };
  learning.notes[word.id] = 'private-note-never-exposed';
  learning.events.push({ id: 'synthetic-result', wordId: word.id, mode: 'meaning', outcome: 'correct', at: clock, delayed: false, answer: 'private-answer-never-exposed', nextDue: clock });
  db.prepare('INSERT INTO learner_state(user_id,payload,revision,updated_at) VALUES(?,?,?,?)').run('bob', JSON.stringify(learning), 1, clock);
  await post(bob, { type: 'profile', profile: { ...profile, shareLearning: true } });
  const stats = await detail(alice, 'bob');
  assert.deepEqual(stats.body.stats, { passages: 1, encountered: 1, practices: 1, level: learning.settings.level, updatedAt: clock });
  assert.ok(!JSON.stringify(stats).includes('never-exposed'));
  await post(bob, { type: 'profile', profile });
  assert.equal((await detail(alice, 'bob')).body.stats, null);
  check('learning sharing is opt-in, aggregate-only, and revoked immediately');

  assert.equal((await post(alice, { type: 'remove', userId: 'bob' })).status, 200);
  assert.equal((await detail(alice, 'bob')).status, 404);
  const declined = (await post(alice, { type: 'request', userId: 'bob' })).body.outgoing[0].requestId;
  assert.equal((await post(bob, { type: 'decline', requestId: declined })).status, 200);
  const cancelled = (await post(alice, { type: 'request', userId: 'bob' })).body.outgoing[0].requestId;
  assert.equal((await post(alice, { type: 'cancel', requestId: cancelled })).status, 200);
  assert.equal((await post(bob, { type: 'accept', requestId: cancelled })).status, 409);
  check('remove, decline and cancel routes revoke access and reject stale acceptance');

  const operationId = crypto.randomUUID(), invitation = await post(alice, { type: 'invite', operationId });
  assert.equal(invitation.status, 200); assert.match(invitation.body.code, /^WW-[a-f0-9]{64}$/);
  assert.equal((await post(alice, { type: 'invite', operationId })).status, 409);
  const invites = await get(alice, '?view=invites&userId=bob');
  assert.deepEqual(invites.body.invites.map(invite => invite.id), [invitation.body.id]);
  assert.equal(invites.body.invites[0].code, undefined);
  assert.equal((await get(bob, '?view=invites&userId=alice')).body.invites.length, 0);
  assert.equal((await post(bob, { type: 'revoke-invite', inviteId: invitation.body.id })).status, 404);
  assert.equal((await post(alice, { type: 'revoke-invite', inviteId: invitation.body.id })).body.invites.length, 0);
  check('one-time invitations, idempotency receipts, private lists and creator-only revocation');

  for (const invalid of [null, [], { type: 'profile', profile, userId: 'alice' }, { type: 'request', userId: 'bob', requesterId: 'eve' }, { type: 'profile', profile: { ...profile, avatarDataUrl: 'https://evil.test/tracker.jpg' } }]) {
    assert.equal((await post(alice, invalid)).status, 400);
  }
  const raw = body => new Request('https://friends.test/api/friends', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://friends.test', Cookie: `wordweave_session=${alice}` }, body });
  assert.equal((await invoke(raw('{broken'))).status, 400);
  assert.equal((await invoke(raw(new Uint8Array([0xff])))).status, 400);
  assert.equal((await invoke(raw('x'.repeat(24577)))).status, 413);
  assert.equal((await invoke(raw('中'.repeat(8193)))).status, 413);
  assert.equal((await invoke(new Request('https://friends.test/api/friends', { method: 'POST' }))).status, 400);
  assert.equal(db.prepare('SELECT nickname FROM friend_profiles WHERE user_id = ?').get('bob').nickname, profile.nickname);
  check('strict schemas, malformed UTF-8/JSON, absent bodies and actual byte-size limits preserve account data');

  const pending = (await post(alice, { type: 'request', userId: 'bob' })).body.outgoing[0].requestId;
  failWrite = true;
  const originalError = console.error;
  try {
    console.error = () => {};
    const failed = await post(bob, { type: 'accept', requestId: pending });
    assert.equal(failed.status, 503); assert.equal(failed.body.code, 'service_unavailable');
    assert.ok(!JSON.stringify(failed).includes('Synthetic private storage detail'));
  } finally { console.error = originalError; }
  assert.equal(db.prepare('SELECT status FROM friend_links WHERE request_id = ?').get(pending).status, 'pending');
  assert.equal((await post(bob, { type: 'accept', requestId: pending })).status, 200);
  check('unexpected storage failures return sanitized JSON and allow retry without losing the request');

  db.prepare('DELETE FROM app_sessions WHERE token_hash = ?').run(await api.digest(alice));
  assert.equal((await get(alice)).status, 401);
  assert.equal((await post(alice, { type: 'invite', operationId: crypto.randomUUID() })).status, 401);
  assert.equal((await get(bob)).status, 200);
  assert.equal(db.prepare('SELECT payload FROM learner_state WHERE user_id = ?').get('bob').payload, JSON.stringify(learning));
  check('revoked website sessions lose access without affecting another account or learning records');

  console.log(JSON.stringify({ pass: true, cases: cases.length, checks: cases }, null, 2));
} finally {
  globalThis.fetch = originalFetch; Date.now = originalNow;
  delete globalThis.webFriendsTestEnv; delete globalThis.webFriendsCookies; db.close();
}
