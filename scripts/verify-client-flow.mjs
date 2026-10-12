import {build} from 'esbuild';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import path from 'node:path';
const runtime=path.resolve('.sites-runtime/flow');await mkdir(runtime,{recursive:true});
await build({stdin:{contents:"export {initialState} from './lib/learning'; export {readingPassages} from './lib/curriculum';",resolveDir:process.cwd(),loader:'ts'},bundle:true,platform:'node',format:'esm',outfile:path.join(runtime,'client-fixture.mjs')});
const {initialState,readingPassages}=await import(pathToFileURL(path.join(runtime,'client-fixture.mjs')));
const fixture={state:initialState(),passages:readingPassages,width:1440};
const saveBundle=await build({stdin:{contents:"export {applyAction} from './lib/learning'; export {createSaveDelta} from './lib/save-delta';",resolveDir:process.cwd(),loader:'ts'},bundle:true,platform:'node',format:'iife',globalName:'saveRegression',write:false});
const template=await readFile('scripts/verify-client-flow-template.cjs','utf8');
await writeFile(path.join(runtime,'client-regression.cjs'),template.replace('/* __SAVE_MODULE__ */',()=>saveBundle.outputFiles[0].text).replace('const fixture = __FIXTURE__;',`const fixture = ${JSON.stringify(fixture)};`));
function cli(args){const r=spawnSync(process.env.ComSpec,['/d','/s','/c',`npx.cmd --yes --package @playwright/cli playwright-cli -s=wordweave-flow ${args}`],{encoding:'utf8',maxBuffer:64*1024*1024});if(r.status!==0)throw Error(r.stderr||r.stdout.slice(0,1500));return r.stdout;}
try{
  cli('close');cli('open http://127.0.0.1:8792 --browser chrome');
  const raw=cli('run-code --filename .sites-runtime/flow/client-regression.cjs');
  if(!raw.startsWith('### Result'))throw Error(raw.slice(0,1500));
  const result=JSON.parse(JSON.parse(raw.split(/\r?\n/)[1]));
  await writeFile(path.join(runtime,'client-regression.json'),JSON.stringify(result,null,2));
  if(!result.pass)throw Error('Client flow regression failed');
  console.log(JSON.stringify(result));
}finally{cli('close');}
