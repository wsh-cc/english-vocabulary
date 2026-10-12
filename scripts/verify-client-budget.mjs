import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
const root='dist/client';
const manifest=JSON.parse(fs.readFileSync(path.join(root,'.vite/manifest.json'),'utf8'));
const seen=new Set();const files=new Set();
function visit(key){if(seen.has(key))return;seen.add(key);const chunk=manifest[key];assert.ok(chunk,'Missing built entry '+key);if(chunk.file.endsWith('.js'))files.add(chunk.file);for(const dependency of chunk.imports??[])visit(dependency);}
visit('app/entry.tsx');
const bytes=[...files].reduce((sum,file)=>sum+fs.statSync(path.join(root,file)).size,0);
assert.ok(bytes<700000,`Signed-out JavaScript budget exceeded: ${bytes} bytes`);
assert.ok(!seen.has('app/study-app.tsx'),'Learning must not be a static entry dependency');
for(const name of ['lesson','library','review','statistics'])assert.ok(manifest['app/study-app.tsx'].dynamicImports.includes(`app/${name}.tsx`),`${name} should load on demand`);
console.log(`PASS: signed-out static dependency graph is ${bytes} bytes (<700000); learning and secondary views load on demand.`);

visit('app/study-app.tsx');
const signedInBytes=[...files].reduce((sum,file)=>sum+fs.statSync(path.join(root,file)).size,0);
assert.ok(signedInBytes<2000000, 'Signed-in initial JavaScript budget exceeded: '+signedInBytes+' bytes');
console.log('PASS: signed-in initial dependency graph is '+signedInBytes+' bytes (<2000000), including the login entry; secondary views remain deferred.');
