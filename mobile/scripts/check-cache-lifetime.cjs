async page => {
  const checks = [];
  const check = (name, pass, detail) => checks.push({name, pass, detail});
  await page.emulateMedia({reducedMotion:'no-preference'});
  const nav = page.getByRole('navigation', {name:'主导航'});
  await nav.getByRole('button', {name:'词库',exact:true}).click();
  await page.getByRole('button', {name:'快速浏览',exact:true}).click();
  await page.getByRole('button', {name:'结束浏览',exact:true}).click();
  await page.waitForTimeout(400);
  check('completed practice is unmounted', await page.locator('.ww-session').count() === 0, await page.locator('.ww-session').count());
  const cdp = await page.context().newCDPSession(page);
  const counters = async () => { await cdp.send('HeapProfiler.collectGarbage'); return {dom:await cdp.send('Memory.getDOMCounters'),heap:(await cdp.send('Runtime.getHeapUsage')).usedSize}; };
  await page.evaluate(async () => {
    const buttons=[...document.querySelectorAll('.app-bottom-nav button')];
    for(const button of buttons){button.click();await new Promise(resolve=>setTimeout(resolve,400));}
  });
  const before = await counters();
  await page.evaluate(async () => {
    const buttons=[...document.querySelectorAll('.app-bottom-nav button')];
    for(let i=0;i<200;i++){buttons[i%buttons.length].click();await new Promise(requestAnimationFrame);}
    await new Promise(resolve=>setTimeout(resolve,400));
  });
  const after = await counters();
  const pages = await page.locator('.app-view').count();
  check('only five primary pages remain cached',pages===5,pages);
  check('200 switches do not accumulate DOM nodes',after.dom.nodes<=before.dom.nodes+30,{before:before.dom.nodes,after:after.dom.nodes});
  check('200 switches do not accumulate listeners',after.dom.jsEventListeners<=before.dom.jsEventListeners+5,{before:before.dom.jsEventListeners,after:after.dom.jsEventListeners});
  check('heap growth stays below 2 MiB after GC',after.heap-before.heap<2*1024*1024,{before:before.heap,after:after.heap});
  check('finished animations are released',await page.evaluate(()=>document.querySelector('#main-content').getAnimations({subtree:true}).length===0));

  // Warm the portal's delegated event handlers once, then repeat the actual open/close paths.
  const round = async () => {
    await nav.getByRole('button', {name:'词库',exact:true}).click();
    await page.locator('.ww-word-card').first().click();
    await page.evaluate(() => window.dispatchEvent(new Event('ww:back',{cancelable:true})));
    await page.waitForTimeout(260);
    await page.getByRole('button', {name:'快速浏览',exact:true}).click();
    await page.getByRole('button', {name:'结束浏览',exact:true}).click();
    await page.waitForTimeout(400);
  };
  await round();
  const warm = await counters();
  for (let i=0;i<12;i++) await round();
  const repeated = await counters();
  check('12 overlay/practice cycles release temporary pages and dialogs',await page.locator('.ww-session, .app-presence').count()===0);
  check('12 overlay/practice cycles keep retained DOM and listeners bounded',repeated.dom.nodes<=warm.dom.nodes+30&&repeated.dom.jsEventListeners<=warm.dom.jsEventListeners+5,{before:warm.dom,after:repeated.dom});
  check('12 overlay/practice cycles keep heap growth below 2 MiB',repeated.heap-warm.heap<2*1024*1024,{before:warm.heap,after:repeated.heap});
  await page.emulateMedia({reducedMotion:'reduce'});
  await round();
  check('reduced motion also releases the completed practice',await page.locator('.app-view').count()===5&&await page.locator('.ww-session, .app-presence').count()===0);
  await page.emulateMedia({reducedMotion:'no-preference'});
  await cdp.detach();
  return JSON.stringify({pass:checks.every(check=>check.pass),checks});
}
