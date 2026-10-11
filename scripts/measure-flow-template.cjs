/* global __FIXTURE__ */
// eslint-disable-next-line @typescript-eslint/no-unused-expressions -- The CLI evaluates this callback template.
async (page) => {
  const fixture=__FIXTURE__;
  const state=fixture.state, passages=fixture.passages;
  let revision=1, requests=[];
  const tag=()=>`"flow-${revision}"`;
  await page.setViewportSize({width:fixture.width,height:900});
  await page.emulateMedia({reducedMotion:'reduce'});
  const cdp=await page.context().newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate',{rate:4});
  await page.addInitScript(() => {
    window.__flowObserver?.disconnect();
    window.__flow={longTasks:[],errors:[]};
    window.__flowObserver=new PerformanceObserver(list=>window.__flow.longTasks.push(...list.getEntries().map(e=>({start:e.startTime,duration:e.duration}))));
    window.__flowObserver.observe({type:'longtask',buffered:true});
    addEventListener('error',e=>window.__flow.errors.push(e.message));
    addEventListener('unhandledrejection',e=>window.__flow.errors.push(String(e.reason)));
  });
  await page.unrouteAll({behavior:'wait'});
  await page.route('**/api/**',async route=>{
    const req=route.request(), url=new URL(req.url()), method=req.method();
    requests.push({path:url.pathname,method,etag:req.headers()['if-none-match']??'',at:Date.now()});
    await new Promise(resolve=>setTimeout(resolve,120));
    const respond=(body,status=200,headers={})=>route.fulfill({status,contentType:'application/json',headers,body:status===304?'':JSON.stringify(body)});
    if(url.pathname==='/api/state'){
      if(method==='GET')return respond({state,revision,user:{name:'流畅度测试'}},req.headers()['if-none-match']===tag()?304:200,{etag:tag()});
      const a=req.postDataJSON();if(a.type==='settings')state.settings={...state.settings,...a.settings};
      if(a.type==='note')state.notes[a.wordId]=a.note;
      if(a.type==='result'){state.events.push({id:a.operationId,wordId:a.wordId,mode:a.mode,outcome:a.outcome,answer:a.answer,at:Date.now(),nextDue:Date.now()+86400000,delayed:true});}
      revision++;return respond({state,revision},200,{etag:tag()});
    }
    if(url.pathname==='/api/passages'){
      if(method==='GET')return respond({passage:passages.find(p=>p.id===url.searchParams.get('id'))??passages.find(p=>!state.reading.completed[p.id])??passages[0],history:passages.slice(0,30).map(p=>({id:p.id,title:p.title,count:p.wordIds.length,completed:!!state.reading.completed[p.id]})),nextCursor:null,available:passages.length,completedCount:Object.keys(state.reading.completed).length});
      const a=req.postDataJSON();if(a.action==='next'){const index=passages.findIndex(p=>p.id===a.afterId);return respond({passage:passages[(index+1)%passages.length]});}
      state.reading.completed[a.id]=Date.now();for(const id of passages.find(p=>p.id===a.id).wordIds)state.reading.encounters[id]={count:1,last:Date.now()};revision++;
      return respond({state,revision},200,{etag:tag()});
    }
    return respond({error:'Unsupported synthetic request'},400);
  });
  await page.reload();
  await page.getByRole('heading',{name:'今日学习',exact:true}).waitFor();
  await page.getByRole('button',{name:'我的词库',exact:true}).click();
  await page.getByRole('textbox',{name:'搜索单词或中文释义'}).waitFor();
  const results=[];
  async function measure(name,action,feedback,ready,event='pointerdown'){
    const offset=requests.length;
    await page.evaluate(({feedback,ready,event})=>{
      window.__step={start:0,feedback:null,ready:null,longOffset:window.__flow.longTasks.length};
      document.addEventListener(event,()=>{window.__step.start=performance.now();},{once:true,capture:true});
      window.__done=new Promise(resolve=>{
        setTimeout(resolve,10000);
        const f=new Function('return ('+feedback+')'), r=new Function('return ('+ready+')');
        function frame(){const step=window.__step;if(step.start){if(step.feedback===null&&f())step.feedback=performance.now()-step.start;if(r()){step.ready=performance.now()-step.start;resolve();return;}}requestAnimationFrame(frame);}requestAnimationFrame(frame);
      });
    },{feedback,ready,event});
    await action();
    const timing=await page.evaluate(async()=>{await window.__done;await new Promise(r=>requestAnimationFrame(r));return {...window.__step,longTasks:window.__flow.longTasks.slice(window.__step.longOffset)};});
    results.push({name,feedbackMs:Math.round(timing.feedback*10)/10,readyMs:Math.round(timing.ready*10)/10,longTasks:timing.longTasks,requests:requests.slice(offset).map(({path,method,etag})=>({path,method,etag}))});
  }
  for(let i=0;i<6;i++){
    const input=page.getByRole('textbox',{name:'搜索单词或中文释义'});
    await input.fill('');
    await measure('search',()=>input.fill('zz-flow-none'),`document.querySelector('input[aria-label="搜索单词或中文释义"]').value==='zz-flow-none'`,`document.querySelectorAll('.word-card').length===0`,'input');
    await input.fill('');
    await measure(i===0?'stats-cold':'stats',()=>page.getByRole('button',{name:'学习记录',exact:true}).click(),`!!document.querySelector('.main-nav button.active')?.textContent.includes('学习记录')`,`!!document.querySelector('#data-backup')`);
    await measure('today',()=>page.getByRole('button',{name:'今日学习',exact:true}).click(),`!!document.querySelector('.main-nav button.active')?.textContent.includes('今日学习')`,`!!document.querySelector('.welcome-card')`);
    await measure('library',()=>page.getByRole('button',{name:'我的词库',exact:true}).click(),`!!document.querySelector('.main-nav button.active')?.textContent.includes('我的词库')`,`document.querySelectorAll('.word-card').length===30`);
  }
  for(let i=0;i<5;i++){
    await measure('word-open',()=>page.locator('.word-card').first().click(),`!!document.querySelector('[role="dialog"]')`,`!!document.querySelector('#personal-note')`);
    await page.getByRole('textbox',{name:'我的联想'}).fill('flow note '+i);
    await measure('note-save',()=>page.getByRole('button',{name:'保存联想',exact:true}).click(),`document.querySelector('.word-sheet')?.textContent.includes('正在保存')||document.querySelector('.word-sheet')?.textContent.includes('保存中')`,`document.querySelector('.word-sheet')?.textContent.includes('联想已保存。')`);
    await page.keyboard.press('Escape');
  }
  for(let i=0;i<7;i++)await page.getByRole('button',{name:'再显示 30 个',exact:true}).click();
  const frames=await page.evaluate(async()=>{
    const intervals=[];let last=performance.now();
    for(let i=0;i<60;i++){await new Promise(r=>requestAnimationFrame(r));const now=performance.now();intervals.push(now-last);last=now;window.scrollBy(0,80);}return intervals;
  });
  await page.getByRole('button',{name:'今日学习',exact:true}).click();
  await page.locator('.due-overview .primary').click();
  for(let i=0;i<5;i++){
    await page.getByRole('textbox',{name:'你的答案'}).fill('synthetic answer');
    await page.getByRole('button',{name:'提交并核对答案',exact:true}).click();
    const question=await page.locator('.review-heading > span').textContent();
    await measure('answer-save',()=>page.getByRole('button',{name:'核对后，独立答对',exact:true}).click(),`document.querySelector('.feedback .primary')?.disabled`,`document.querySelector('.review-heading > span')?.textContent!==${JSON.stringify(question)}`);
  }
  await page.getByRole('button',{name:'结束本轮',exact:true}).click();
  await measure('reading-cold',()=>page.getByRole('button',{name:'句子学习',exact:true}).click(),`!!document.querySelector('.main-nav button.active')?.textContent.includes('句子学习')`,`!!document.querySelector('.reading-story')`);
  for(let i=0;i<5;i++){
    const title=await page.locator('.reading-paper h2').textContent();
    await measure('reading-next',()=>page.getByRole('button',{name:'读完，继续下一段',exact:true}).click(),`!!document.querySelector('.reading-status')`,`!document.querySelector('.reading-status')&&document.querySelector('.reading-paper h2')?.textContent!==${JSON.stringify(title)}`);
  }
  await page.evaluate(()=>dispatchEvent(new Event('focus')));
  await page.waitForTimeout(400);
  return JSON.stringify({label:fixture.label,events:fixture.count,width:fixture.width,cpu:4,apiDelayMs:120,reducedMotion:true,results,scrollFrames:frames,focusRequest:requests.at(-1),errors:await page.evaluate(()=>window.__flow.errors)});
}
