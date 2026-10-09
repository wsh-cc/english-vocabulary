import assert from 'node:assert/strict';
import fs from 'node:fs';
const base='http://127.0.0.1:8791';
const {cookie}=JSON.parse(fs.readFileSync('.sites-runtime/qa-login.json','utf8'));
const get=(tag,authenticated=true)=>fetch(base+'/api/state',{headers:{...(authenticated?{Cookie:cookie}:{}),...(tag?{'If-None-Match':tag}:{})}});
const first=await get();assert.equal(first.status,200);const original=await first.json();
const tag=first.headers.get('etag');assert.ok(tag,'Authenticated state must provide an ETag for lightweight sync');
const unchanged=await get(tag);assert.equal(unchanged.status,304);assert.equal(await unchanged.text(),'');
assert.equal((await get(tag,false)).status,401,'validator must never bypass authentication');
assert.equal((await get('"another-account-'+original.revision+'"')).status,200);
assert.equal((await get()).status,200,'old clients remain supported');
const settings={daily:original.state.settings.daily===10?6:10};
const write=body=>fetch(base+'/api/state',{method:'POST',headers:{Cookie:cookie,Origin:base,'Content-Type':'application/json'},body:JSON.stringify({...body,operationId:crypto.randomUUID()})});
try {
 const changed=await write({type:'settings',settings});assert.equal(changed.status,200);
 const refreshed=await get(tag);assert.equal(refreshed.status,200);const updated=await refreshed.json();assert.equal(updated.state.settings.daily,settings.daily);assert.ok(updated.revision>original.revision);
 assert.notEqual(refreshed.headers.get('etag'),tag);assert.equal((await get(refreshed.headers.get('etag'))).status,304);
}finally{assert.equal((await write({type:'settings',settings:{daily:original.state.settings.daily}})).status,200);}
console.log('PASS: conditional sync has an empty 304 body, auth enforced, stale and cross-account validators refresh, old clients work, writes invalidate the validator. Isolated QA only.');
