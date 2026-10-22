import assert from 'node:assert/strict';
import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { build } from 'esbuild';

// Real registration route, crypto, invitation helpers and migrations. All
// accounts and secrets below are synthetic; no network or production database.
const db = new DatabaseSync(':memory:');
db.exec('PRAGMA foreign_keys = ON');
for (const file of fs.readdirSync('drizzle').filter(file => file.endsWith('.sql')).sort()) db.exec(fs.readFileSync(`drizzle/${file}`, 'utf8'));
let failConsumption = false;
function prepare(sql) {
  let values = [];
  const execute = () => {
    if (failConsumption && sql.startsWith('UPDATE social_invites SET consumed_at')) { failConsumption = false; throw Error('Synthetic storage failure'); }
    return { meta: { changes: Number(db.prepare(sql).run(...values).changes) } };
  };
  return { bind(...args) { values = args; return this; }, async first() { const row = db.prepare(sql).get(...values); return row ? { ...row } : null; }, async all() { return { results: db.prepare(sql).all(...values).map(row => ({ ...row })) }; }, async run() { return execute(); }, execute };
}
const d1 = { prepare, async batch(statements) {
  db.exec('BEGIN');
  try { const result = statements.map(statement => statement.execute()); db.exec('COMMIT'); return result; }
  catch (error) { db.exec('ROLLBACK'); throw error; }
} };
globalThis.inviteTestEnv = { DB: d1, PASSWORD_PEPPER: 'synthetic-invitation-test-pepper', REGISTRATION_KEY_HASH: '' };
globalThis.inviteTestCookie = '';
const originalFetch = globalThis.fetch, originalNow = Date.now;
globalThis.fetch = () => { throw Error('Network forbidden in invitation verification.'); };
let clock = 1792500000000;
Date.now = () => clock;
const cases = [];
try {
  const bundled = await build({
    stdin: { contents: "export * as registration from './app/api/auth/route'; export * as invitations from './lib/friend-invites'; export { digest } from './lib/auth-crypto'; export { getAccount } from './lib/auth'; export { mobileLogin, requireMobileAccount } from './lib/mobile-auth';", resolveDir: process.cwd(), loader: 'ts' },
    bundle: true, platform: 'node', format: 'esm', write: false,
    plugins: [{ name: 'isolated-invitation-handlers', setup(builder) {
      builder.onResolve({ filter: /^(cloudflare:workers|next\/headers)$/ }, args => ({ path: args.path, namespace: 'invite-test' }));
      builder.onLoad({ filter: /.*/, namespace: 'invite-test' }, args => ({ contents: args.path === 'cloudflare:workers' ? 'export const env = globalThis.inviteTestEnv;' : 'export const cookies = async () => ({ get: name => name === "wordweave_session" && globalThis.inviteTestCookie ? {value: globalThis.inviteTestCookie} : undefined });' }));
    } }],
  });
  const api = await import('data:text/javascript;base64,' + Buffer.from(bundled.outputFiles[0].text).toString('base64'));
  const { createFriendInvite: create, listFriendInvites: list, revokeFriendInvite: revoke } = api.invitations;
  const ownerKey = 'SyntheticOwnerKey-OnlyForTests', password = 'SyntheticPassword-OnlyForTests';
  globalThis.inviteTestEnv.REGISTRATION_KEY_HASH = await api.digest(ownerKey);
  let ipSequence = 0;
  const post = async (body, headers = {}) => {
    const response = await api.registration.POST(new Request('https://invite.test/api/auth', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://invite.test', 'cf-connecting-ip': `192.0.2.${++ipSequence}`, ...headers }, body: JSON.stringify(body) }));
    assert.equal(response.headers.get('cache-control'), 'no-store');
    return { status: response.status, body: await response.json(), cookie: response.headers.get('set-cookie') };
  };
  const register = (username, invitation, headers) => post({ action: 'register', username, password, invitation }, headers);
  const countAccounts = () => db.prepare('SELECT COUNT(*) AS n FROM app_accounts').get().n;
  const inviteRow = id => db.prepare('SELECT * FROM social_invites WHERE id = ?').get(id);
  const accountFor = username => db.prepare('SELECT * FROM app_accounts WHERE username_normalized = ?').get(username.toLowerCase());
  const mint = userId => create(userId, crypto.randomUUID());
  const selectCookie = cookie => { globalThis.inviteTestCookie = cookie.match(/^wordweave_session=([^;]+)/)?.[1] ?? ''; };

  const owners = await Promise.all([register('OwnerOne', ownerKey), register('OwnerTwo', ownerKey)]);
  assert.deepEqual(owners.map(result => result.status).sort(), [200, 409]);
  assert.equal(countAccounts(), 1);
  const owner = db.prepare("SELECT * FROM app_accounts WHERE slot = 'owner'").get();
  const ownerCookie = owners.find(result => result.status === 200).cookie;
  assert.match(ownerCookie, /HttpOnly/); assert.match(ownerCookie, /SameSite=Strict/); assert.match(ownerCookie, /Secure/);
  assert.equal((await register('OwnerThree', ownerKey)).status, 409);
  assert.equal((await register('BadInvite', 'not-an-invitation')).status, 403);
  cases.push('original private key keeps atomic singleton owner registration');

  const operationId = crypto.randomUUID(), first = await create(owner.user_id, operationId);
  assert.equal(first.createdAt, clock); assert.equal(first.expiresAt, clock + 7 * 86400000);
  assert.match(first.code, /^WW-[a-f0-9]{64}$/);
  assert.equal(inviteRow(first.id).token_hash, await api.digest(first.code));
  assert.ok(!JSON.stringify(inviteRow(first.id)).includes(first.code));
  const listed = await list(owner.user_id);
  assert.deepEqual(listed.invites, [{ id: first.id, createdAt: first.createdAt, expiresAt: first.expiresAt }]);
  assert.ok(!JSON.stringify(listed).includes(first.code));
  await assert.rejects(create(owner.user_id, operationId), error => error.status === 409 && error.code === 'invite_operation_used');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM social_invites').get().n, 1);
  cases.push('only token digest stored; one-time code omitted from lists and operation retries');

  const beforeCsrf = countAccounts();
  assert.equal((await register('CrossOrigin', first.code, { Origin: 'https://evil.test' })).status, 403);
  assert.equal((await register('CrossSite', first.code, { 'sec-fetch-site': 'cross-site' })).status, 403);
  assert.equal((await post({ action: 'register', username: 'ShortPassword', password: 'short', invitation: first.code })).status, 400);
  assert.equal(countAccounts(), beforeCsrf); assert.equal(inviteRow(first.id).consumed_at, null);
  cases.push('origin and credential validation cannot consume invitations');

  const firstRegistration = await register('MemberOne', first.code);
  assert.equal(firstRegistration.status, 200);
  const member = accountFor('MemberOne');
  assert.equal(inviteRow(first.id).consumed_by, member.user_id);
  assert.equal(inviteRow(first.id).consumed_at, clock);
  assert.equal(member.slot, 'member:' + member.user_id);
  assert.notEqual(member.user_id, owner.user_id);
  assert.equal((await list(owner.user_id)).invites.length, 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM friend_links').get().n, 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM friend_profiles').get().n, 0);
  const accountCount = countAccounts();
  assert.equal((await register('ReuseAttempt', first.code)).status, 403);
  assert.equal(countAccounts(), accountCount);
  cases.push('one-time registration creates a separate account without automatic friendship or profile publication');

  selectCookie(ownerCookie);
  assert.deepEqual(await api.getAccount(), { userId: owner.user_id, name: owner.username });
  selectCookie(firstRegistration.cookie);
  assert.deepEqual(await api.getAccount(), { userId: member.user_id, name: 'MemberOne' });
  const memberLogin = await post({ action: 'login', username: 'memberone', password });
  assert.equal(memberLogin.status, 200); selectCookie(memberLogin.cookie);
  assert.equal((await api.getAccount()).userId, member.user_id);
  const mobileLogin = await api.mobileLogin('MEMBERONE', password, 'synthetic-member-device', 'synthetic-mobile-ip');
  assert.deepEqual(mobileLogin.user, { userId: member.user_id, name: 'MemberOne' });
  const mobileAccount = await api.requireMobileAccount(new Request('https://invite.test/api/mobile/friends', { headers: { Authorization: 'Bearer ' + mobileLogin.token } }));
  assert.equal(mobileAccount.userId, member.user_id);
  assert.equal((await post({ action: 'login', username: 'MemberOne', password: 'WrongPassword-Synthetic' })).status, 401);
  cases.push('invited users log into web and mobile with separate authenticated identities');

  const privateInvite = await mint(owner.user_id), memberInvite = await mint(member.user_id);
  assert.deepEqual((await list(member.user_id)).invites.map(invite => invite.id), [memberInvite.id]);
  assert.deepEqual((await list(owner.user_id)).invites.map(invite => invite.id), [privateInvite.id]);
  await assert.rejects(revoke(member.user_id, privateInvite.id), error => error.status === 404);
  await assert.rejects(revoke(owner.user_id, crypto.randomUUID()), error => error.status === 404);
  assert.equal(inviteRow(privateInvite.id).revoked_at, null);
  assert.equal((await revoke(member.user_id, memberInvite.id)).invites.length, 0);
  assert.equal((await revoke(member.user_id, memberInvite.id)).invites.length, 0);
  assert.equal((await register('RevokedInvite', memberInvite.code)).status, 403);
  await assert.rejects(create(member.user_id, inviteRow(memberInvite.id).operation_id), error => error.code === 'invite_operation_used');
  cases.push('invite lists and revocation are creator-isolated; revocation is idempotent and permanent');

  const collision = await register('mEmBeRoNe', privateInvite.code);
  assert.equal(collision.status, 409); assert.equal(collision.body.code, 'username_taken');
  assert.equal(inviteRow(privateInvite.id).consumed_at, null);
  assert.equal((await register('AfterCollision', privateInvite.code)).status, 200);
  cases.push('case-insensitive username collisions preserve the invitation for another name');

  const raced = await mint(owner.user_id), beforeRace = countAccounts();
  const redemptions = await Promise.all([register('ParallelOne', raced.code), register('ParallelTwo', raced.code)]);
  assert.deepEqual(redemptions.map(result => result.status).sort(), [200, 403]);
  assert.equal(countAccounts(), beforeRace + 1);
  const winningAccount = accountFor(redemptions[0].status === 200 ? 'ParallelOne' : 'ParallelTwo');
  assert.equal(inviteRow(raced.id).consumed_by, winningAccount.user_id);
  cases.push('concurrent redemptions create exactly one account and one consumption');

  const nameRaceInvites = await Promise.all([mint(owner.user_id), mint(member.user_id)]);
  const beforeNameRace = countAccounts();
  const nameRace = await Promise.all(nameRaceInvites.map(invite => register('SameNameRace', invite.code)));
  assert.deepEqual(nameRace.map(result => result.status).sort(), [200, 409]);
  assert.equal(countAccounts(), beforeNameRace + 1);
  const unusedNameRace = nameRaceInvites[nameRace.findIndex(result => result.status === 409)];
  assert.equal(inviteRow(unusedNameRace.id).consumed_at, null);
  assert.equal((await register('NameRaceRetry', unusedNameRace.code)).status, 200);
  cases.push('concurrent equal usernames consume only the winning invite and preserve the other');

  const rollback = await mint(owner.user_id), beforeFailure = countAccounts();
  failConsumption = true;
  assert.equal((await register('RetryAfterFailure', rollback.code)).status, 503);
  assert.equal(countAccounts(), beforeFailure); assert.equal(inviteRow(rollback.id).consumed_at, null);
  assert.equal(accountFor('RetryAfterFailure'), undefined);
  assert.equal((await register('RetryAfterFailure', rollback.code)).status, 200);
  cases.push('storage failure between account insertion and consumption rolls back both; retry works');

  const expiring = await mint(owner.user_id);
  clock = expiring.expiresAt;
  assert.equal((await list(owner.user_id)).invites.length, 0);
  assert.equal((await register('ExpiredAtBoundary', expiring.code)).status, 403);
  assert.equal(inviteRow(expiring.id).consumed_at, null);
  await assert.rejects(create(owner.user_id, inviteRow(expiring.id).operation_id), error => error.code === 'invite_operation_used');
  cases.push('seven-day expiry is enforced at the exact boundary and never resets operation receipts');

  const atLimit = await Promise.allSettled(Array.from({ length: 9 }, () => mint(owner.user_id)));
  assert.equal(atLimit.filter(result => result.status === 'fulfilled').length, 5);
  assert.ok(atLimit.filter(result => result.status === 'rejected').every(result => result.reason.code === 'invite_limit'));
  assert.equal((await list(owner.user_id)).invites.length, 5);
  const secondUserInvite = await mint(member.user_id);
  assert.equal((await list(member.user_id)).invites.length, 1);
  const active = atLimit.find(result => result.status === 'fulfilled').value;
  await revoke(owner.user_id, active.id);
  await mint(owner.user_id);
  assert.equal((await list(owner.user_id)).invites.length, 5);
  assert.equal(inviteRow(secondUserInvite.id).revoked_at, null);
  cases.push('atomic five-active-invite limit survives concurrent creation and is per account');

  for (const invite of (await list(owner.user_id)).invites) await revoke(owner.user_id, invite.id);
  const repeatedOperation = crypto.randomUUID();
  const repeated = await Promise.allSettled([create(owner.user_id, repeatedOperation), create(owner.user_id, repeatedOperation)]);
  assert.equal(repeated.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(repeated.find(result => result.status === 'rejected').reason.code, 'invite_operation_used');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM social_invites WHERE creator_id = ? AND operation_id = ?').get(owner.user_id, repeatedOperation).n, 1);
  const sameOperationOtherCreator = await create(member.user_id, repeatedOperation);
  assert.notEqual(sameOperationOtherCreator.id, repeated.find(result => result.status === 'fulfilled').value.id);
  await assert.rejects(mint('missing-account'), error => error.status === 401);
  cases.push('concurrent operation replay creates one code while independent creators retain their own operation scope');

  const unconsumed = repeated.find(result => result.status === 'fulfilled').value;
  assert.equal((await post({ action: 'register', username: 'Oversized', password, invitation: unconsumed.code, extra: 'x'.repeat(4096) })).status, 413);
  assert.equal(inviteRow(unconsumed.id).consumed_at, null);
  db.prepare('DELETE FROM auth_attempts').run();
  const sameIp = { 'cf-connecting-ip': 'synthetic-limited-ip' };
  let limited;
  for (let index = 0; index < 11; index++) limited = await register('RateLimitedUser', 'invalid', sameIp);
  assert.equal(limited.status, 429);
  assert.equal(inviteRow(unconsumed.id).consumed_at, null);
  cases.push('body limit and shared authentication rate limit remain enforced');

  const dailyStart = clock;
  for (const invite of (await list(owner.user_id)).invites) await revoke(owner.user_id, invite.id);
  let dailyCount = db.prepare('SELECT COUNT(*) AS n FROM social_invites WHERE creator_id = ? AND created_at > ?').get(owner.user_id, clock - 86400000).n;
  while (dailyCount < 19) { const invite = await mint(owner.user_id); await revoke(owner.user_id, invite.id); dailyCount++; }
  const atDailyLimit = await Promise.allSettled([mint(owner.user_id), mint(owner.user_id), mint(owner.user_id)]);
  assert.equal(atDailyLimit.filter(result => result.status === 'fulfilled').length, 1);
  assert.ok(atDailyLimit.filter(result => result.status === 'rejected').every(result => result.reason.code === 'invite_daily_limit'));
  const twentieth = atDailyLimit.find(result => result.status === 'fulfilled').value;
  await revoke(owner.user_id, twentieth.id);
  assert.equal((await list(owner.user_id)).invites.length, 0);
  await assert.rejects(mint(owner.user_id), error => error.status === 429 && error.code === 'invite_daily_limit' && error.message.includes('24'));
  await assert.rejects(create(owner.user_id, inviteRow(twentieth.id).operation_id), error => error.status === 409 && error.code === 'invite_operation_used');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM social_invites WHERE creator_id = ? AND created_at > ?').get(owner.user_id, clock - 86400000).n, 20);
  await mint(member.user_id);
  clock = dailyStart + 86400000 - 1;
  await assert.rejects(mint(owner.user_id), error => error.code === 'invite_daily_limit');
  clock++;
  await mint(owner.user_id);
  assert.equal((await list(owner.user_id)).invites.length, 1);
  cases.push('rolling 24-hour creation cap counts revoked invites, is atomic and account-scoped, and releases at the boundary');

  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM app_accounts WHERE slot = 'owner'").get().n, 1);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM social_invites WHERE token_hash NOT GLOB ? OR length(token_hash) != 64').get('[a-f0-9]*').n, 0);
  console.log(JSON.stringify({ pass: true, cases: cases.length, checks: cases }, null, 2));
} finally {
  globalThis.fetch = originalFetch; Date.now = originalNow;
  delete globalThis.inviteTestEnv; delete globalThis.inviteTestCookie;
  db.close();
}
