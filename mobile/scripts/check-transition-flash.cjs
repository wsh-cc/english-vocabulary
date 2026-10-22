async page => {
  await page.reload();
  await page.setViewportSize({width:393,height:852});
  await page.emulateMedia({reducedMotion:'no-preference'});
  await page.getByRole('navigation', {name:'主导航'}).waitFor();
  await page.waitForTimeout(400);
  // Installed only for this diagnostic run. Each callback delegates to the real animation API.
  await page.evaluate(() => {
    window.__flashSamples=[];
    window.__flashCancel=Animation.prototype.cancel;
    Animation.prototype.cancel=function() {
      const target=this.effect?.target;
      const leaving=target instanceof HTMLElement&&(target.matches('.app-view[data-exiting]')||target.closest('.app-presence[data-closing]'));
      const before=leaving?Number(getComputedStyle(target).opacity):0;
      const ended=this.playState==='finished';
      window.__flashCancel.call(this);
      if(leaving&&ended)window.__flashSamples.push({page:target.dataset.page??target.className,before,after:Number(getComputedStyle(target).opacity),display:getComputedStyle(target).display});
    };
  });
  const result = await page.evaluate(async () => {
    const frames = [];
    const raf = () => new Promise(requestAnimationFrame);
    const buttons = [...document.querySelectorAll('.app-bottom-nav button')];
    // Ordinary forward/back transitions, including different retained scroll positions.
    for (const index of [1,2,0]) {
      if(index===0) window.scrollTo(0,320);
      buttons[index].click();
      const start=performance.now();
      while(performance.now()-start<450) {
        const outgoing=document.querySelector('.app-view[data-exiting]');
        frames.push({transition:index,t:Math.round(performance.now()-start),page:outgoing?.dataset.page,opacity:outgoing?Number(getComputedStyle(outgoing).opacity):null});
        await raf();
      }
    }
    const visibleFrames=frames.filter(frame=>frame.page);
    const jumps=visibleFrames.filter((frame,i)=>i>0&&frame.transition===visibleFrames[i-1].transition&&frame.opacity>visibleFrames[i-1].opacity+.01);
    return {frameOpacityJumps:jumps,sampledFrames:frames.length};
  });
  const checks=[];
  const check=(name,pass,detail)=>checks.push({name,pass,detail});
  check('old page opacity never rises again during ordinary and scrolled transitions',result.frameOpacityJumps.length===0,result);
  const nav=page.getByRole('navigation',{name:'主导航'});
  await nav.getByRole('button',{name:'阅读',exact:true}).click();
  const reversal=await page.evaluate(async()=>{
    const stack=document.querySelector('.app-view-stack');
    const animations=stack.getAnimations({subtree:true});
    for(const animation of animations){animation.pause();animation.currentTime=110;}
    await new Promise(requestAnimationFrame);
    const before=[...document.querySelectorAll('.app-view[data-active], .app-view[data-exiting]')].map(node=>({id:node.dataset.page,opacity:Number(getComputedStyle(node).opacity),transform:getComputedStyle(node).transform}));
    document.querySelector('.app-bottom-nav button[aria-label="今日"]').click();
    for(let i=0;i<30&&document.querySelector('.app-view[data-active]')?.dataset.page!=='today';i++)await new Promise(requestAnimationFrame);
    const from=stack.getAnimations({subtree:true}).map(animation=>({id:animation.effect.target.dataset.page,...animation.effect.getKeyframes()[0]}));
    return {before,from,pass:before.length===2&&before.every(sample=>from.some(frame=>frame.id===sample.id&&Math.abs(Number(frame.opacity)-sample.opacity)<.001&&frame.transform===sample.transform))};
  });
  check('reversing a page slide preserves both pages current position and opacity',reversal.pass,reversal);
  await page.waitForTimeout(400);
  await page.getByRole('button',{name:/^学习词表：/}).click();
  await page.waitForTimeout(270);
  await page.getByRole('button',{name:'取消选择'}).click();
  await page.waitForTimeout(260);
  const cdp=await page.context().newCDPSession(page);
  try{
    await cdp.send('Emulation.setCPUThrottlingRate',{rate:4});
    const stress=await page.evaluate(async()=>{
      const buttons=[...document.querySelectorAll('.app-bottom-nav button')];
      const hidden=[];
      for(let i=0;i<60;i++){
        buttons[i%5].click();await new Promise(requestAnimationFrame);
        for(const node of document.querySelectorAll('.app-view:not([data-active]):not([data-exiting])')){
          if(node.getClientRects().length&&Number(getComputedStyle(node).opacity)>.001)hidden.push(node.dataset.page);
        }
      }
      await new Promise(resolve=>setTimeout(resolve,450));
      return {hidden,active:document.querySelector('.app-view[data-active]')?.dataset.page,exiting:document.querySelectorAll('.app-view[data-exiting]').length,animations:document.querySelector('.app-view-stack').getAnimations({subtree:true}).length};
    });
    check('60 rapid switches at 4x CPU never expose unrelated cached pages',stress.hidden.length===0,stress);
    check('rapid switches settle on the last requested page',stress.active==='my'&&stress.exiting===0&&stress.animations===0,stress);
  }finally{await cdp.send('Emulation.setCPUThrottlingRate',{rate:1});await cdp.detach();}
  const cancellations=await page.evaluate(()=>{Animation.prototype.cancel=window.__flashCancel;const samples=window.__flashSamples;delete window.__flashCancel;delete window.__flashSamples;return samples;});
  const rebound=cancellations.filter(sample=>sample.before<.01&&sample.after>.01&&sample.display!=='none');
  check('finished pages and overlays stay transparent when animations are released',cancellations.some(sample=>sample.page==='ww-choice-panel')&&rebound.length===0,{cancellations,rebound});
  return JSON.stringify({pass:checks.every(check=>check.pass),checks});
}
