import { build } from 'esbuild';
import { writeFile, mkdir, readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
const runtime=path.resolve('.sites-runtime/flow');
await mkdir(runtime,{recursive:true});
await build({stdin:{contents:"export * from './lib/learning'; export { readingPassages } from './lib/curriculum'; export { stateSchema } from './lib/validation';",resolveDir:process.cwd(),loader:'ts'},bundle:true,platform:'node',format:'esm',outfile:path.join(runtime,'fixture.mjs')});
const {initialState,seedWords,availableModes,DAY,readingPassages,stateSchema}=await import(pathToFileURL(path.join(runtime,'fixture.mjs')));
const count=Number(process.argv[2]??10000), width=Number(process.argv[3]??1440), label=process.argv[4]??'baseline';
if(![0,1000,10000].includes(count)||![1440,390].includes(width)||!/^[a-zA-Z0-9_-]+$/.test(label))throw Error('Invalid synthetic benchmark arguments.');
const state=initialState(), now=Date.parse('2026-10-11T04:00:00Z');state.settings.onboarded=true;
for(let i=0;i<seedWords.length;i++){const w=seedWords[i];state.learned[w.id]=now-(i%3)*DAY;state.progress[w.id]={};for(const mode of availableModes(w))state.progress[w.id][mode]={due:now-DAY,streak:1,attempts:1,correct:1,hinted:0,wrong:0,last:now-2*DAY,interval:DAY};}
for(let i=0;i<count;i++){const w=seedWords[i*37%seedWords.length], modes=availableModes(w);state.events.push({id:'flow-event-'+i,wordId:w.id,mode:modes[i%modes.length],outcome:['correct','hinted','wrong'][i%3],answer:'synthetic',at:now-(i%60)*DAY,nextDue:now+DAY,delayed:i%2===0});}
if(!stateSchema.safeParse(state).success)throw Error('Invalid synthetic fixture');
const saveBundle=await build({stdin:{contents:"export { applyAction } from './lib/learning'; export { createSaveDelta } from './lib/save-delta';",resolveDir:process.cwd(),loader:'ts'},bundle:true,platform:'node',format:'iife',globalName:'saveBenchmark',write:false});
const fixture={state,passages:readingPassages.filter(p=>p.level==='CET6'),count,width,label};
const template=await readFile('scripts/measure-flow-template.cjs','utf8');
await writeFile(path.join(runtime,`run-${label}-${width}-${count}.cjs`),template.replace('/* __SAVE_MODULE__ */',()=>saveBundle.outputFiles[0].text).replace('const fixture=__FIXTURE__;',`const fixture=${JSON.stringify(fixture)};`));
