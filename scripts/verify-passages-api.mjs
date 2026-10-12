import assert from 'node:assert/strict';
import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { build } from 'esbuild';
import { createHash } from 'node:crypto';

// Only in-memory SQLite. This test never writes to the learner's database.
const db = new DatabaseSync(':memory:');
for (const file of fs.readdirSync('drizzle').filter(file => file.endsWith('.sql')).sort()) db.exec(fs.readFileSync('drizzle/' + file, 'utf8'));
let beforeWrite = null;
const d1 = { prepare(sql) { const statement = db.prepare(sql); let values = []; return {
  bind(...args) { values = args; return this; },
  async first() { return statement.get(...values) ?? null; },
  async all() { return { results: statement.all(...values) }; },
  async run() { const hook=beforeWrite;beforeWrite=null;hook?.();return { meta: { changes: Number(statement.run(...values).changes) } }; },
}; } };
globalThis.readingTestEnv = { DB: d1 };
globalThis.readingTestCookie = 'a'.repeat(64);
for (const [userId, token] of [['reader', 'a'.repeat(64)], ['other', 'b'.repeat(64)]]) {
  db.prepare('INSERT INTO app_accounts VALUES (?, ?, ?, ?, ?, ?, ?)').run(userId, userId, userId, userId, 'test', 'test', Date.now());
  db.prepare('INSERT INTO app_sessions VALUES (?, ?, ?)').run(createHash('sha256').update(token).digest('hex'), userId, Date.now() + 3600000);
}
await build({ entryPoints: ['app/api/passages/route.ts'], outfile: '.sites-runtime/passages-api-test.mjs', bundle: true, platform: 'node', format: 'esm', plugins: [{
  name: 'isolated-runtime', setup(build) {
    build.onResolve({ filter: /^(cloudflare:workers|next\/headers)$/ }, args => ({ path: args.path, namespace: 'reading-test' }));
    build.onLoad({ filter: /.*/, namespace: 'reading-test' }, args => ({ contents: args.path === 'cloudflare:workers' ? 'export const env = globalThis.readingTestEnv;' : 'export const cookies = async () => ({get: () => globalThis.readingTestCookie ? ({value: globalThis.readingTestCookie}) : undefined});' }));
  },
}] });
const { GET, POST } = await import('../.sites-runtime/passages-api-test.mjs');
const request = (body, headers = {}) => new Request('http://reading.test/api/passages', { method: 'POST', headers: { Origin: 'http://reading.test', 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
const get = async (query = '') => { const response = await GET(new Request('http://reading.test/api/passages' + query)); return { status: response.status, body: await response.json() }; };
const post = async body => { const response = await POST(request(body)); return { status: response.status, body: await response.json() }; };
const originalFetch = globalThis.fetch;
globalThis.fetch = () => { throw Error('The built-in course must not use external services.'); };

try {
  globalThis.readingTestCookie = '';
  assert.equal((await get()).status, 401);
  assert.equal((await post({action:'next'})).status, 401);
  globalThis.readingTestCookie = 'a'.repeat(64);
  assert.equal((await POST(request({action:'next'}, {Origin:'https://other.test'}))).status, 403);
  assert.equal((await post({action:'generate',count:30})).status, 400);
  assert.equal((await post({action:'complete',id:crypto.randomUUID(),operationId:crypto.randomUUID(),advance:'yes'})).status, 400);
  assert.equal((await post({action:'next', extra:'x'.repeat(3000)})).status, 413);
  assert.equal((await get('?id=bad')).status, 400);
  assert.equal((await get('?cursor=bad')).status, 400);
  const missing = crypto.randomUUID();
  assert.equal((await get('?id='+missing)).status, 404);
  assert.equal((await get('?cursor='+missing)).status, 404);
  assert.equal((await post({action:'next',afterId:missing})).status, 404);

  const first = await get();
  assert.equal(first.status, 200); assert.equal(first.body.available, 58); assert.equal(first.body.completedCount, 0);
  assert.equal(first.body.history.length, 30); assert.equal(first.body.summary.covered, 0);
  assert.equal((await post({action:'next'})).body.passage.id, first.body.passage.id);
  assert.equal(db.prepare('SELECT COUNT(*) AS total FROM learner_state').get().total, 0, 'Opening is not reading');
  const complete = {action:'complete',id:first.body.passage.id,operationId:crypto.randomUUID()};
  const saved = await post(complete);
  assert.equal(saved.status, 200); assert.equal(saved.body.summary.covered, first.body.passage.wordIds.length);
  assert.equal(Object.hasOwn(saved.body,'passage'),false,'Legacy completion remains save-only');
  assert.deepEqual(saved.body.state.events, []); assert.deepEqual(saved.body.state.learned, {});
  const retried = await post(complete); assert.equal(retried.body.revision, saved.body.revision);
  const reread = await post({...complete,operationId:crypto.randomUUID()});
  assert.equal(reread.body.summary.reread, 0);
  assert.equal((await get()).body.passage.id, first.body.history[1].id, 'Reopening resumes first unread');
  assert.equal((await post({action:'next',afterId:first.body.passage.id})).body.passage.id, first.body.history[1].id);
  assert.equal((await get('?id='+first.body.passage.id)).body.passage.id, first.body.passage.id, 'Read paragraphs remain available');
  assert.equal((await get()).body.completedCount, 1);
  const found = new Set(); let cursor = '';
  do {
    const page = await get(cursor ? '?cursor='+cursor : '');
    for (const item of page.body.history) { assert.ok(!found.has(item.id)); found.add(item.id); }
    cursor = page.body.nextCursor;
  } while (cursor);
  assert.equal(found.size, 58);
  const course=[];let pageCursor='';
  do{const page=await get(pageCursor?'?cursor='+pageCursor:'');course.push(...page.body.history);pageCursor=page.body.nextCursor;}while(pageCursor);
  const mutateReader=mutate=>{
    const row=db.prepare('SELECT payload,revision FROM learner_state WHERE user_id=?').get('reader');
    const state=JSON.parse(row.payload);mutate(state);
    db.prepare('UPDATE learner_state SET payload=?,revision=revision+1 WHERE user_id=?').run(JSON.stringify(state),'reader');
  };
  const advancedAction={action:'complete',id:course[1].id,operationId:crypto.randomUUID(),advance:true};
  const advanced=await post(advancedAction);
  assert.equal(advanced.status,200);
  assert.equal(advanced.body.passage.id,course[2].id,'Combined response selects from saved state');
  assert.equal(advanced.body.completedCount,2);
  assert.equal(advanced.body.state.reading.completed[course[1].id]>0,true);
  assert.deepEqual(advanced.body.state.events,[]);
  // A lost response is retried after another device completes the expected next.
  mutateReader(state=>{state.reading.completed[course[2].id]=Date.now();});
  const beforeRetry=db.prepare('SELECT revision FROM learner_state WHERE user_id=?').get('reader').revision;
  const duplicate=await post(advancedAction);
  assert.equal(duplicate.body.revision,beforeRetry,'Duplicate operation does not write');
  assert.equal(duplicate.body.passage.id,course[3].id,'Duplicate returns current authoritative selection');
  assert.deepEqual(duplicate.body.state.reading.encounters,advanced.body.state.reading.encounters,'Duplicate does not increment encounters');
  // Force the first CAS to fail: another device completes the original next.
  beforeWrite=()=>mutateReader(state=>{state.reading.completed[course[4].id]=Date.now();});
  const raced=await post({action:'complete',id:course[3].id,operationId:crypto.randomUUID(),advance:true});
  assert.equal(raced.status,200);assert.equal(beforeWrite,null);
  assert.equal(raced.body.passage.id,course[5].id,'CAS retry chooses next from successful committed snapshot');
  assert.equal(raced.body.completedCount,5);
  const saveOnly=await post({action:'complete',id:course[5].id,operationId:crypto.randomUUID(),advance:false});
  assert.equal(saveOnly.status,200);assert.equal(Object.hasOwn(saveOnly.body,'passage'),false);
  const nextOnly=await post({action:'next',afterId:course[5].id});
  assert.equal(nextOnly.body.passage.id,course[6].id);assert.equal(nextOnly.body.completedCount,6);
  mutateReader(state=>{for(const passage of course)state.reading.completed[passage.id]=Date.now();});
  const loop=await post({action:'complete',id:course.at(-1).id,operationId:crypto.randomUUID(),advance:true});
  assert.equal(loop.body.passage.id,course[0].id,'Completed course loops for rereading');
  assert.equal(loop.body.completedCount,58);

  // A different account shares content, but never the first account's reading progress.
  globalThis.readingTestCookie = 'b'.repeat(64);
  assert.equal((await get()).body.summary.covered, 0);
  assert.equal((await get()).body.passage.id, first.body.passage.id);
  globalThis.readingTestCookie = 'a'.repeat(64);
  const row = db.prepare('SELECT payload FROM learner_state WHERE user_id=?').get('reader');
  const state = JSON.parse(row.payload); state.settings.level = 'CET4';
  db.prepare('UPDATE learner_state SET payload=? WHERE user_id=?').run(JSON.stringify(state),'reader');
  const cet4 = await get(); assert.equal(cet4.body.available,3); assert.equal(cet4.body.completedCount,0);
  assert.equal(cet4.body.passage.level,'CET4'); assert.equal(cet4.body.nextCursor,null);
  assert.equal((await post({...complete,operationId:crypto.randomUUID()})).status,404);
  assert.equal((await get('?id='+first.body.passage.id)).status,404);
  console.log('PASS: real handlers + isolated SQLite; auth, origin, size, pagination, level isolation, static content, resume, combined continuation, save-only compatibility, duplicate retry, CAS race, completed-course loop, shared content/private records. Zero external calls.');
} finally { globalThis.fetch = originalFetch; db.close(); }
