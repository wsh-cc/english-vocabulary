import {spawnSync} from 'node:child_process';
import {writeFile} from 'node:fs/promises';
const label=process.argv[2]??'after';
if(!/^[a-zA-Z0-9_-]+$/.test(label))throw Error('Use a simple result label.');
function cli(args){const r=spawnSync(process.env.ComSpec,['/d','/s','/c',`npx.cmd --yes --package @playwright/cli playwright-cli -s=wordweave-flow ${args}`],{encoding:'utf8',maxBuffer:64*1024*1024});if(r.status!==0)throw Error(r.stderr||r.stdout.slice(0,1000));return r.stdout;}
try{for(const width of [1440,390])for(const count of [0,1000,10000]){
  if(process.argv.includes('--mobile-only')&&width!==390)continue;
  cli('close');cli('open http://127.0.0.1:8792 --browser chrome');
  const build=spawnSync(process.execPath,['scripts/build-flow-fixture.mjs',String(count),String(width),label],{encoding:'utf8'});if(build.status!==0)throw Error(build.stderr);
  const raw=cli(`run-code --filename .sites-runtime/flow/run-${label}-${width}-${count}.cjs`);
  const line=raw.split(/\r?\n/)[1];if(!raw.startsWith('### Result'))throw Error(raw.slice(0,1000));
  const result=JSON.parse(JSON.parse(line));
  for(const step of result.results){if(step.readyMs===null||step.feedbackMs===null)throw Error('Timed out: '+step.name);step.longTasks=[...new Map(step.longTasks.map(t=>[t.start+'-'+t.duration,t])).values()];}
  await writeFile(`.sites-runtime/flow/${label}-${width}-${count}.json`,JSON.stringify(result,null,2));
  const summary={label,width,count,errors:result.errors,steps:result.results.length};
  for(const name of ['search','today','note-save','answer-save','reading-next']){const rows=result.results.filter(r=>r.name===name).map(r=>r.readyMs).sort((a,b)=>a-b);summary[name]={median:rows[Math.floor(rows.length/2)],worst:rows.at(-1)};}
  console.log(JSON.stringify(summary));
}}finally{cli('close');}
