async (page) => {
  // Copy only the isolated preview account into the production preview origin.
  await page.goto('http://127.0.0.1:5188');
  const fixture = await page.evaluate(() => {
    const raw = localStorage.getItem('wordweave-mobile-state-v1');
    if (!raw || JSON.parse(JSON.parse(raw).stateJson).user?.userId !== 'preview') throw Error('A disposable preview account is required.');
    return raw;
  });
  await page.goto('http://127.0.0.1:5189');
  await page.evaluate(raw => localStorage.setItem('wordweave-mobile-state-v1', raw), fixture);
  await page.reload();
  await page.setViewportSize({ width: 393, height: 852 });
  await page.getByRole('navigation', { name: '主导航' }).waitFor();
  await page.waitForTimeout(350);
  const cdp = await page.context().newCDPSession(page);
  const results = [];
  try {
    for (const slowdown of [1, 4]) {
      await cdp.send('Emulation.setCPUThrottlingRate', { rate: slowdown });
      const result = await page.evaluate(async () => {
        const buttons = [...document.querySelectorAll('.app-bottom-nav button')];
        const ids = ['today', 'reading', 'library', 'stats', 'my'];
        const samples = [], intervals = [], longTasks = [];
        const observer = new PerformanceObserver(list => list.getEntries().forEach(entry => longTasks.push(entry.duration)));
        observer.observe({ type: 'longtask' });
        let ticking = true, previous = performance.now();
        const tick = now => { if (!ticking) return; intervals.push(now - previous); previous = now; requestAnimationFrame(tick); };
        requestAnimationFrame(tick);
        for (let i = 1; i <= 30; i++) {
          const index = i % buttons.length;
          const start = performance.now();
          buttons[index].click();
          await new Promise(requestAnimationFrame);
          const feedbackMs = performance.now() - start;
          let ready = false;
          for (let frame = 0; frame < 60; frame++) {
            if (document.querySelector('.app-view[data-active]')?.dataset.page === ids[index]) { ready = true; break; }
            await new Promise(requestAnimationFrame);
          }
          samples.push({ feedbackMs, readyMs: performance.now() - start, ready, selected: buttons[index].getAttribute('aria-current') === 'page' });
          await new Promise(resolve => setTimeout(resolve, 400));
        }
        ticking = false; observer.disconnect();
        const stats = values => { const sorted = [...values].sort((a,b) => a-b); return { p50: +sorted[Math.floor(sorted.length*.5)].toFixed(1), p95: +sorted[Math.floor(sorted.length*.95)].toFixed(1), max: +sorted.at(-1).toFixed(1) }; };
        return { pass: samples.every(sample => sample.ready && sample.selected && sample.feedbackMs < 100 && sample.readyMs < 250), switches: samples.length, feedbackMs: stats(samples.map(sample => sample.feedbackMs)), readyMs: stats(samples.map(sample => sample.readyMs)), frameIntervalMs: stats(intervals.slice(1)), longTasks, retainedPages: document.querySelectorAll('.app-view').length, residualAnimations: document.querySelector('#main-content').getAnimations({ subtree: true }).length };
      });
      results.push({ slowdown, ...result });
    }
  } finally { await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 }); await cdp.detach(); }
  return JSON.stringify({ pass: results.every(result => result.pass), environment: 'Desktop Chromium, production build, 393x852. CPU throttling is not an Android device FPS measurement.', results });
}
