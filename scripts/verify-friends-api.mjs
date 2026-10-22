import assert from 'node:assert/strict';
import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { build } from 'esbuild';

// Actual route/auth/service code against SQLite; only D1 transport is replaced.
// Fixtures are synthetic and all networking is forbidden.
const db = new DatabaseSync(':memory:');
db.exec('PRAGMA foreign_keys = ON');
for (const file of fs.readdirSync('drizzle').filter(file => file.endsWith('.sql')).sort()) db.exec(fs.readFileSync(`drizzle/${file}`, 'utf8'));
let failWrite = false, beforeWrite = null;
function prepare(sql) {
  let values = [];
  const execute = () => {
    if (beforeWrite && /^(INSERT INTO friend_links|UPDATE friend_links)/.test(sql)) { const hook = beforeWrite; beforeWrite = null; hook(); }
    if (failWrite && sql.startsWith('UPDATE friend_links')) { failWrite = false; throw Error('Injected write failure'); }
    return { meta: { changes: Number(db.prepare(sql).run(...values).changes) } };
  };
  return { bind(...args) { values = args; return this; }, async first() { return db.prepare(sql).get(...values) ?? null; }, async all() { return { results: db.prepare(sql).all(...values) }; }, async run() { return execute(); }, execute };
}
globalThis.friendsTestEnv = { DB: { prepare, async batch(statements) { db.exec('BEGIN'); try { const results = statements.map(statement => statement.execute()); db.exec('COMMIT'); return results; } catch (error) { db.exec('ROLLBACK'); throw error; } } }, PASSWORD_PEPPER: 'friends-synthetic-pepper' };
const originalFetch = globalThis.fetch, originalNow = Date.now;
globalThis.fetch = () => { throw Error('Network forbidden in friends API verification.'); };
let clock = 1792500000000;
Date.now = () => clock;
const cases = [];
try {
  const bundle = await build({
    stdin: { contents: "export * as friends from './app/api/mobile/friends/route'; export * as auth from './app/api/mobile/auth/route'; export { initialState, seedWords } from './lib/learning'; export { readingPassages } from './lib/curriculum'; export { digest } from './lib/auth-crypto';", resolveDir: process.cwd(), loader: 'ts' },
    bundle: true, platform: 'node', format: 'esm', write: false,
    plugins: [{ name: 'isolated-friends', setup(builder) { builder.onResolve({ filter: /^cloudflare:workers$/ }, args => ({ path: args.path, namespace: 'friends-test' })); builder.onLoad({ filter: /.*/, namespace: 'friends-test' }, () => ({ contents: 'export const env = globalThis.friendsTestEnv;' })); } }],
  });
  const api = await import('data:text/javascript;base64,' + Buffer.from(bundle.outputFiles[0].text).toString('base64'));
  const accounts = new Map();
  async function account(id, name = id, expired = false) {
    const token = crypto.randomUUID().replaceAll('-', '') + crypto.randomUUID().replaceAll('-', '');
    db.prepare('INSERT INTO app_accounts (slot,user_id,username,username_normalized,password_hash,salt,created_at) VALUES (?,?,?,?,?,?,?)').run(id, id, name, name.toLowerCase(), 'synthetic-unused-hash', 'synthetic', clock);
    db.prepare('INSERT INTO mobile_sessions (token_hash,user_id,device_id,created_at,expires_at) VALUES (?,?,?,?,?)').run(await api.digest(token), id, 'synthetic-device', clock, expired ? clock - 1 : clock + 30 * 86400000);
    accounts.set(id, { token, name });
    return token;
  }
  const alice = await account('alice', 'Alice'), bob = await account('bob', 'Bob'), eve = await account('eve', 'Eve');
  const read = async response => { assert.equal(response.headers.get('cache-control'), 'no-store'); return { status: response.status, body: await response.json() }; };
  const request = (query = '', body, token, extra = {}) => new Request(`https://friends.test/api/mobile/friends${query}`, { ...(body === undefined ? {} : { method: 'POST', body: JSON.stringify(body) }), headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...extra } });
  const get = (token, query = '') => api.friends.GET(request(query, undefined, token)).then(read);
  const post = (token, body) => api.friends.POST(request('', body, token)).then(read);
  const detail = (token, userId) => get(token, '?view=detail&userId=' + userId);
  const search = (token, username) => get(token, '?view=search&username=' + encodeURIComponent(username));
  const profile = { nickname: 'Private Bob', signature: 'Only accepted friends see this', avatar: 'custom', avatarDataUrl: 'data:image/jpeg;base64,/9j/2Q==', shareLearning: false };
  const sanitized = { userId: 'bob', username: 'Bob', nickname: '', signature: '', avatar: 'initial' };
  const pair = (a, b) => JSON.stringify([a, b].sort());
  const seedLink = (a, b, status = 'accepted', requestId = crypto.randomUUID()) => { db.prepare('INSERT INTO friend_links(pair_key,request_id,requester_id,recipient_id,status,created_at,updated_at,accepted_at) VALUES(?,?,?,?,?,?,?,?)').run(pair(a, b), requestId, a, b, status, clock, clock, status === 'accepted' ? clock : null); return requestId; };
  const check = name => cases.push(name);

  assert.equal((await get()).status, 401);
  assert.equal((await api.friends.GET(request('', undefined, undefined, { Cookie: 'wordweave_session=fake' })).then(read)).status, 401);
  assert.equal((await post(undefined, { type: 'request', userId: 'bob' })).status, 401);
  assert.equal((await get(await account('expired', 'Expired', true))).status, 401);
  check('bearer-only authorization and expired sessions');

  const initial = await get(alice);
  assert.equal(initial.status, 200);
  assert.deepEqual(initial.body, { friends: [], incoming: [], outgoing: [], profile: { nickname: '', signature: '', avatar: 'initial', shareLearning: false }, published: false, serverTime: clock });
  assert.equal(db.prepare('SELECT COUNT(*) n FROM learner_state').get().n, 0);
  assert.equal((await post(bob, { type: 'profile', profile })).status, 200);
  assert.equal((await get(bob)).body.profile.avatarDataUrl, profile.avatarDataUrl);
  assert.equal((await get(alice)).body.published, false);
  check('private-by-default profile, account isolation and custom avatar persistence');

  assert.deepEqual((await search(alice, 'bOB')).body, { user: sanitized, relationship: 'none' });
  assert.deepEqual((await search(alice, 'MissingUser')).body, { user: null, relationship: 'none' });
  assert.equal((await search(alice, 'Bo')).status, 400);
  assert.equal((await search(alice, 'Bob%')).status, 400);
  assert.equal((await search(alice, 'Alice')).body.relationship, 'self');
  assert.equal((await detail(alice, 'bob')).status, 404);
  assert.equal((await detail(bob, 'bob')).status, 404);
  assert.equal((await post(alice, { type: 'request', userId: 'alice' })).status, 400);
  assert.equal((await post(alice, { type: 'request', userId: 'unknown' })).status, 404);
  check('exact username discovery discloses only minimal identity');

  const sent = await post(alice, { type: 'request', userId: 'bob' });
  assert.equal(sent.status, 200);
  const requestId = sent.body.outgoing[0].requestId;
  assert.deepEqual(sent.body.outgoing[0].user, sanitized);
  assert.equal((await get(bob)).body.incoming[0].requestId, requestId);
  assert.equal((await search(alice, 'Bob')).body.relationship, 'outgoing');
  assert.equal((await search(bob, 'Alice')).body.relationship, 'incoming');
  assert.equal((await detail(alice, 'bob')).status, 404);
  assert.equal((await detail(bob, 'alice')).status, 404);
  check('directed requests and no profile access before acceptance');

  const duplicate = await post(alice, { type: 'request', userId: 'bob' });
  assert.equal(duplicate.body.outgoing[0].requestId, requestId);
  const crossed = await post(bob, { type: 'request', userId: 'alice' });
  assert.equal(crossed.body.incoming[0].requestId, requestId);
  assert.equal(crossed.body.friends.length, 0);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM friend_links').get().n, 1);
  for (const type of ['accept', 'decline']) assert.equal((await post(alice, { type, requestId })).status, 403);
  assert.equal((await post(bob, { type: 'cancel', requestId })).status, 403);
  for (const type of ['accept', 'decline', 'cancel']) assert.equal((await post(eve, { type, requestId })).status, 403);
  check('duplicate and crossed requests stay one pending relation; action direction enforced');

  const accepted = await post(bob, { type: 'accept', requestId });
  assert.equal(accepted.status, 200); assert.equal(accepted.body.friends.length, 1);
  assert.equal((await post(bob, { type: 'accept', requestId })).status, 200);
  const friend = (await detail(alice, 'bob')).body;
  assert.deepEqual(friend.user, { ...sanitized, ...Object.fromEntries(Object.entries(profile).filter(([key]) => key !== 'shareLearning')) });
  assert.equal(friend.stats, null);
  assert.equal((await detail(bob, 'alice')).status, 200);
  assert.equal((await detail(eve, 'bob')).status, 404);
  assert.deepEqual((await search(eve, 'Bob')).body.user, sanitized);
  assert.deepEqual((await search(alice, 'Bob')).body.user, sanitized);
  check('accepted friends receive shared profile but no statistics without consent');

  const learning = api.initialState(), passage = api.readingPassages[0], word = api.seedWords[0];
  learning.reading.completed[passage.id] = clock;
  learning.reading.completed['unknown-passage'] = clock;
  learning.reading.encounters[word.id] = { count: 2, last: clock };
  learning.reading.encounters['unknown-word'] = { count: 3, last: clock };
  learning.events.push({ id: 'synthetic-practice', wordId: word.id, mode: 'meaning', outcome: 'wrong', at: clock, delayed: false, answer: 'private-answer', nextDue: clock });
  learning.notes[word.id] = 'private-note'; learning.settings.level = 'CET4';
  db.prepare('INSERT INTO learner_state(user_id,payload,revision,updated_at) VALUES(?,?,?,?)').run('bob', JSON.stringify(learning), 4, clock);
  await post(bob, { type: 'profile', profile: { ...profile, shareLearning: true } });
  const visible = await detail(alice, 'bob');
  assert.deepEqual(visible.body.stats, { passages: 1, encountered: 1, practices: 1, level: 'CET4', updatedAt: clock });
  assert.deepEqual(Object.keys(visible.body).sort(), ['since', 'stats', 'user']);
  assert.ok(!JSON.stringify(visible.body).includes('private-answer'));
  assert.ok(!JSON.stringify(visible.body).includes('private-note'));
  assert.ok(!JSON.stringify(visible.body).includes('payload'));
  await post(bob, { type: 'profile', profile });
  assert.equal((await detail(alice, 'bob')).body.stats, null);
  check('opt-in server-derived aggregate only, with immediate privacy revocation');

  assert.equal((await post(eve, { type: 'remove', userId: 'bob' })).status, 404);
  assert.equal((await post(alice, { type: 'remove', userId: 'bob' })).status, 200);
  assert.equal((await post(alice, { type: 'remove', userId: 'bob' })).status, 200);
  assert.equal((await detail(alice, 'bob')).status, 404);
  assert.equal((await detail(bob, 'alice')).status, 404);
  assert.equal((await get(bob)).body.friends.length, 0);
  assert.deepEqual((await search(alice, 'Bob')).body.user, sanitized);
  assert.equal((await post(bob, { type: 'accept', requestId })).status, 409);
  check('removal revokes both directions and rejects stale acceptance');

  const newRequest = (await post(alice, { type: 'request', userId: 'bob' })).body.outgoing[0].requestId;
  assert.notEqual(newRequest, requestId);
  assert.equal((await post(bob, { type: 'accept', requestId })).status, 404);
  assert.equal((await post(bob, { type: 'decline', requestId: newRequest })).status, 200);
  assert.equal((await post(bob, { type: 'decline', requestId: newRequest })).status, 200);
  assert.equal((await post(alice, { type: 'accept', requestId: newRequest })).status, 403);
  const withdraw = (await post(alice, { type: 'request', userId: 'bob' })).body.outgoing[0].requestId;
  assert.equal((await post(alice, { type: 'cancel', requestId: withdraw })).status, 200);
  assert.equal((await post(alice, { type: 'cancel', requestId: withdraw })).status, 200);
  assert.equal((await post(bob, { type: 'accept', requestId: withdraw })).status, 409);
  check('decline/cancel retries and fresh request ids after terminal states');

  const carol = await account('carol', 'Carol'), dan = await account('dan', 'Dan');
  const concurrent = await Promise.all([post(carol, { type: 'request', userId: 'dan' }), post(dan, { type: 'request', userId: 'carol' })]);
  assert.ok(concurrent.every(response => response.status === 200));
  const crossRow = db.prepare('SELECT * FROM friend_links WHERE pair_key = ?').get(pair('carol', 'dan'));
  assert.equal(crossRow.status, 'pending');
  const recipientToken = accounts.get(crossRow.recipient_id).token;
  const approvals = await Promise.all([post(recipientToken, { type: 'accept', requestId: crossRow.request_id }), post(recipientToken, { type: 'accept', requestId: crossRow.request_id })]);
  assert.ok(approvals.every(response => response.status === 200));
  check('concurrent crossed requests and duplicate acceptance are serialized safely');

  const failingId = (await post(alice, { type: 'request', userId: 'bob' })).body.outgoing[0].requestId;
  failWrite = true;
  const originalError = console.error;
  try { console.error = () => {}; assert.equal((await post(bob, { type: 'accept', requestId: failingId })).status, 503); } finally { console.error = originalError; }
  assert.equal(db.prepare('SELECT status FROM friend_links WHERE request_id = ?').get(failingId).status, 'pending');
  assert.equal((await post(bob, { type: 'accept', requestId: failingId })).status, 200);
  check('failed write leaves pending relation intact and can retry');

  const full = await account('full', 'FullUser'), pendingFull = await account('pending-full', 'PendingFull');
  for (let index = 0; index < 200; index++) { const id = `filler-${index}`; await account(id); seedLink('full', id); }
  for (let index = 0; index < 50; index++) seedLink('pending-full', `filler-${index}`, 'pending');
  assert.equal((await post(full, { type: 'request', userId: 'eve' })).status, 409);
  assert.equal((await post(eve, { type: 'request', userId: 'full' })).status, 409);
  assert.equal((await post(pendingFull, { type: 'request', userId: 'eve' })).status, 409);
  assert.equal((await post(eve, { type: 'request', userId: 'pending-full' })).status, 409);
  assert.equal((await get(full)).body.friends.length, 200);
  assert.equal((await get(pendingFull)).body.outgoing.length, 50);
  check('friend and pending capacities are enforced for both accounts');

  const near = await account('near', 'NearLimit');
  for (let index = 0; index < 199; index++) seedLink('near', `filler-${index}`);
  const atCapacity = seedLink('eve', 'near', 'pending');
  beforeWrite = () => seedLink('near', 'filler-199');
  assert.equal((await post(near, { type: 'accept', requestId: atCapacity })).status, 409);
  assert.equal(db.prepare('SELECT status FROM friend_links WHERE request_id = ?').get(atCapacity).status, 'pending');
  const almostPending = await account('almost-pending', 'AlmostPending');
  for (let index = 0; index < 49; index++) seedLink('almost-pending', `filler-${index}`, 'pending');
  beforeWrite = () => seedLink('almost-pending', 'filler-49', 'pending');
  assert.equal((await post(almostPending, { type: 'request', userId: 'eve' })).status, 409);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM friend_links WHERE pair_key = ?').get(pair('almost-pending', 'eve')).n, 0);
  check('capacity is rechecked atomically when another request wins the race');

  for (const invalid of [{ type: 'profile', profile: { ...profile, avatarDataUrl: 'https://evil.test/tracker.jpg' } }, { type: 'profile', profile: { ...profile, avatarDataUrl: 'data:image/jpeg;base64,/9j/' + 'A'.repeat(16400) } }, { type: 'profile', profile: { ...profile, avatarDataUrl: undefined } }, { type: 'profile', profile: { ...profile, userId: 'eve' } }, { type: 'request', userId: 'bob', requesterId: 'eve' }]) assert.equal((await post(alice, invalid)).status, 400);
  await post(bob, { type: 'profile', profile: { ...profile, avatar: 'sprout' } });
  assert.equal(db.prepare('SELECT avatar_data_url FROM friend_profiles WHERE user_id = ?').get('bob').avatar_data_url, null);
  assert.equal((await get(bob)).body.profile.avatarDataUrl, undefined);
  assert.equal((await get(alice, '?view=unknown')).status, 400);
  check('strict action validation, bounded JPEG input and removed obsolete avatar data');

  const rate = await account('rate', 'RateUser');
  for (let index = 0; index < 20; index++) assert.equal((await post(rate, { type: 'request', userId: `filler-${index}` })).status, 200);
  assert.equal((await post(rate, { type: 'request', userId: 'filler-21' })).status, 429);
  for (let index = 0; index < 30; index++) assert.equal((await search(rate, 'Bob')).status, 200);
  assert.equal((await search(rate, 'Bob')).status, 429);
  clock += 3600001;
  assert.equal((await post(rate, { type: 'request', userId: 'filler-21' })).status, 200);
  assert.equal((await search(rate, 'Bob')).status, 200);
  check('per-account request/search throttles reset after their windows');

  const invite = await post(alice, { type: 'invite', operationId: crypto.randomUUID() });
  assert.equal(invite.status, 200); assert.equal(typeof invite.body.code, 'string');
  const invites = await get(alice, '?view=invites');
  assert.equal(invites.body.invites.length, 1); assert.equal(invites.body.invites[0].code, undefined);
  assert.equal((await get(eve, '?view=invites')).body.invites.length, 0);
  assert.equal((await post(eve, { type: 'revoke-invite', inviteId: invite.body.id })).status, 404);
  assert.equal((await post(alice, { type: 'revoke-invite', inviteId: invite.body.id })).body.invites.length, 0);
  check('invite helper routing and ownership; raw invite secret is never listed');

  assert.equal((await api.auth.POST(request('', { action: 'logout' }, alice)).then(read)).status, 200);
  assert.equal((await get(alice)).status, 401);
  assert.equal((await post(alice, { type: 'profile', profile })).status, 401);
  assert.equal((await get(bob)).status, 200);
  assert.ok(db.prepare('SELECT payload FROM learner_state WHERE user_id = ?').get('bob'));
  check('revoked sessions cannot read or mutate friends and preserve learning');

  console.log(JSON.stringify({ pass: true, cases: cases.length, checks: cases }, null, 2));
} finally {
  globalThis.fetch = originalFetch; Date.now = originalNow; delete globalThis.friendsTestEnv; db.close();
}
