
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import path from 'node:path';
const label=process.argv[2]??'diagnostic-current';
const blank=process.argv.includes('--blank');
const isolated=blank||process.argv.includes('--isolated');
const profile=!process.argv.includes('--no-profile');
const option=(name,fallback)=>process.argv.find(a=>a.startsWith(name+'='))?.slice(name.length+1)??fallback;
const port=Number(option('--port','8792')),count=Number(option('--events','0')),width=Number(option('--width','1440'));
if(![8792,8793].includes(port)||![0,1000,10000].includes(count)||![1440,390].includes(width))throw Error('Invalid diagnostic arguments');
if(!/^[a-zA-Z0-9_-]+$/.test(label))throw Error('Invalid label');
const runtime=path.resolve('.sites-runtime/reading-investigation');await mkdir(runtime,{recursive:true});
const built=spawnSync(process.execPath,['scripts/build-flow-fixture.mjs',String(count),String(width),label],{encoding:'utf8'});
if(built.status)throw Error(built.stderr);
let source=await readFile('.sites-runtime/flow/run-'+label+'-'+width+'-'+count+'.cjs','utf8');
if(blank){const line=source.match(/  const fixture=(.*);/);const fixture=JSON.parse(line[1]);Object.assign(fixture.state,{reading:{encounters:{},completed:{}},progress:{},notes:{},familiar:{},learned:{},events:[],operations:[]});source=source.replace(line[0],'  const fixture='+JSON.stringify(fixture)+';');}
source=source.replace("  await page.addInitScript(() => {", "  await page.addInitScript(() => {\n    window.__requestStages=[];window.__domStages=[];window.__scrollStages=[];\n    const originalScroll=Element.prototype.scrollIntoView;Element.prototype.scrollIntoView=function(...args){const start=performance.now();performance.mark('reading-scroll-start');const value=originalScroll.apply(this,args);const end=performance.now();performance.mark('reading-scroll-end');window.__scrollStages.push({start,end});return value;};\n    const originalFetch=window.fetch;\n    window.fetch=async(...args)=>{\n      const stage={url:String(args[0]),action:args[1]?.body?JSON.parse(args[1].body).action??JSON.parse(args[1].body).type:'GET',start:performance.now()};\n      window.__requestStages.push(stage);\n      const response=await originalFetch(...args);stage.headers=performance.now();\n      const originalJson=response.json.bind(response);\n      response.json=async()=>{stage.jsonStart=performance.now();const value=await originalJson();stage.jsonEnd=performance.now();return value;};\n      return response;\n    };\n    let previous='';\n    const observer=new MutationObserver(()=>{const title=document.querySelector('.reading-paper h2')?.textContent??'';const status=document.querySelector('.reading-status')?.textContent??'';const key=title+'|'+status;if(key!==previous){performance.mark('reading-dom-update');window.__domStages.push({at:performance.now(),title,status});previous=key;}});\n    observer.observe(document,{childList:true,subtree:true,characterData:true});");
source=source.replace("const requestRecord={path:url.pathname,method,etag:req.headers()['if-none-match']??'',at:Date.now()};requests.push(requestRecord);","const requestRecord={path:url.pathname,method,action:method==='POST'?req.postDataJSON().action??req.postDataJSON().type:'GET',etag:req.headers()['if-none-match']??'',at:Date.now(),received:Date.now()};requests.push(requestRecord);");
source=source.replace("await new Promise(resolve=>setTimeout(resolve,120));","await new Promise(resolve=>setTimeout(resolve,120));requestRecord.delayEnd=Date.now();");
source=source.replace("const text=status===304?'':JSON.stringify(body);requestRecord.responseBytes=Buffer.byteLength(text);return route.fulfill({status,contentType:'application/json',headers,body:text});","requestRecord.serializeStart=Date.now();const text=status===304?'':JSON.stringify(body);requestRecord.serializeEnd=Date.now();requestRecord.responseBytes=Buffer.byteLength(text);requestRecord.fulfillStart=Date.now();return route.fulfill({status,contentType:'application/json',headers,body:text}).then(()=>{requestRecord.fulfillEnd=Date.now();});");
source=source.replace("return {...window.__step,longTasks:window.__flow.longTasks.slice(window.__step.longOffset)};","return {...window.__step,longTasks:window.__flow.longTasks.slice(window.__step.longOffset),fetches:window.__requestStages.filter(r=>r.start>=window.__step.start),dom:window.__domStages.filter(r=>r.at>=window.__step.start),scroll:window.__scrollStages.filter(r=>r.start>=window.__step.start)};");
source=source.replace("requests:requests.slice(offset).map(({path,method,etag,responseBytes})=>({path,method,etag,responseBytes}))","fetches:timing.fetches,dom:timing.dom,scroll:timing.scroll,start:timing.start,requests:requests.slice(offset)");
source=source.replace("await new Promise(r=>requestAnimationFrame(r));return {...window.__step", "await new Promise(r=>requestAnimationFrame(r));window.__step.frameReady=performance.now()-window.__step.start;performance.mark('reading-following-frame');return {...window.__step");
source=source.replace("fetches:timing.fetches", "frameReadyMs:Math.round(timing.frameReady*10)/10,fetches:timing.fetches");
if(isolated){
 const start=source.indexOf('  for(let i=0;i<6;i++){');
 const end=source.indexOf("  await measure('reading-cold'",start);
 if(start<0||end<0)throw Error('Prelude markers not found');
 source=source.slice(0,start)+'  const frames=[];\n'+source.slice(end);
}
source=source.replace('step.start=performance.now();',"step.start=performance.now();performance.mark('reading-step-start');");
if(profile){
source=source.replace('  for(let i=0;i<5;i++){\n    const title=await page.locator', "  await cdp.send('Profiler.enable');\n  await cdp.send('Profiler.start');\n  await cdp.send('Tracing.start',{categories:'devtools.timeline,blink.user_timing,v8',transferMode:'ReturnAsStream'});\n  for(let i=0;i<8;i++){\n    const title=await page.locator");
source=source.replace("  await page.evaluate(()=>dispatchEvent(new Event('focus')));", "  const cpuProfile=(await cdp.send('Profiler.stop')).profile;\n  const tracingComplete=new Promise(resolve=>cdp.once('Tracing.tracingComplete',resolve));\n  await cdp.send('Tracing.end');const {stream}=await tracingComplete;let traceText='';while(true){const chunk=await cdp.send('IO.read',{handle:stream});traceText+=chunk.data;if(chunk.eof)break;}await cdp.send('IO.close',{handle:stream});\n  await page.evaluate(()=>dispatchEvent(new Event('focus')));");
source=source.replace("reducedMotion:true,results,", "reducedMotion:true,cpuProfile,trace:JSON.parse(traceText),blank:"+blank+",profile:true,isolated:"+isolated+",results,");
}else{source=source.replace('  for(let i=0;i<5;i++){\n    const title=await page.locator','  for(let i=0;i<8;i++){\n    const title=await page.locator');}
source=source.replace('reducedMotion:true,results,','reducedMotion:true,blank:'+blank+',profile:false,isolated:'+isolated+',results,');
const filename=path.join(runtime,label+'.cjs');await writeFile(filename,source);
function cli(args){const r=spawnSync(process.env.ComSpec,['/d','/s','/c','npx.cmd --yes --package @playwright/cli playwright-cli -s=wordweave-flow '+args],{encoding:'utf8',maxBuffer:128*1024*1024});if(r.status!==0)throw Error(r.stderr||r.stdout.slice(0,1000));return r.stdout;}
try{
 cli('close');cli('open http://127.0.0.1:'+port+' --browser chrome');
 const raw=cli('run-code --filename .sites-runtime/reading-investigation/'+label+'.cjs');
 if(!raw.startsWith('### Result'))throw Error(raw.slice(0,1500));
 const result=JSON.parse(JSON.parse(raw.split(/\r?\n/)[1]));
 await writeFile(path.join(runtime,label+'.json'),JSON.stringify(result,null,2));
 const stages=result.results.filter(s=>s.name==='reading-next').map(s=>({ready:s.readyMs,feedback:s.feedbackMs,fetches:s.fetches.map(f=>({action:f.action,toStart:f.start-s.start,headers:f.headers-f.start,json:f.jsonEnd-f.jsonStart})),dom:s.dom.map(d=>({at:d.at-s.start,title:d.title,status:d.status})),mock:s.requests.map(r=>({action:r.action,delay:r.delayEnd-r.received,serialize:r.serializeEnd-r.serializeStart,fulfill:r.fulfillEnd-r.fulfillStart,bytes:r.responseBytes}))}));
 if(result.errors.length||result.results.some(s=>s.readyMs===null||s.feedbackMs===null))throw Error('Diagnostic did not complete cleanly');
 const sorted=stages.map(s=>s.ready).sort((a,b)=>a-b);console.log(JSON.stringify({label,isolated,blank,profile,width,count,median:(sorted[3]+sorted[4])/2,worst:sorted.at(-1),errors:result.errors,...(process.argv.includes('--stages')?{stages}:{})},null,2));
}finally{cli('close');}
