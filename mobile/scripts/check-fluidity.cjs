async (page) => {
  const checks = [];
  const check = (name, pass, detail) => checks.push({ name, pass, detail });
  await page.setViewportSize({ width: 393, height: 852 });
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  const nav = page.getByRole('navigation', { name: '主导航' });
  await nav.getByRole('button', { name: '今日', exact: true }).click();
  await page.waitForTimeout(400);
  const transition = await page.evaluate(async () => {
    const button = document.querySelector('.app-bottom-nav button[aria-label="词库"]');
    const start = performance.now();
    button.click();
    await new Promise(requestAnimationFrame);
    const feedbackMs = performance.now() - start;
    const selected = button.getAttribute('aria-current') === 'page';
    // The selected Tab is urgent; content is intentionally rendered at lower priority.
    for (let frame = 0; frame < 10 && !document.querySelector('.ww-library')?.getClientRects().length; frame++) await new Promise(requestAnimationFrame);
    return {
      feedbackMs,
      readyMs: performance.now() - start,
      selected,
      durations: [...document.querySelectorAll('.app-view')].flatMap(node => node.getAnimations().map(animation => animation.effect.getTiming().duration)),
      animated: document.getAnimations().some(animation => {
        const node = animation.effect?.target;
        return node instanceof Element && !!node.closest('#main-content');
      }),
    };
  });
  check('tab responds on next frame', transition.selected, transition);
  check('page transition is animated', transition.animated, transition);
  check('production CSS durations remain milliseconds', transition.durations.length === 2 && transition.durations.every(duration => duration >= 300 && duration <= 340), transition.durations);
  await page.waitForTimeout(400);
  const search = page.getByRole('searchbox', { name: '搜索英文单词或中文释义' });
  await search.fill('ab');
  await page.waitForTimeout(100);
  await page.evaluate(() => window.scrollTo(0, 320));
  const scroll = await page.evaluate(() => window.scrollY);
  await nav.getByRole('button', { name: '阅读', exact: true }).click();
  await page.waitForTimeout(400);
  await nav.getByRole('button', { name: '词库', exact: true }).click();
  await page.waitForTimeout(400);
  check('tab preserves search', await search.inputValue() === 'ab', await search.inputValue());
  const restored = await page.evaluate(() => window.scrollY);
  check('tab restores scroll', Math.abs(restored - scroll) < 2, { scroll, restored });
  await page.getByRole('button', { name: /^学习词表：/ }).click();
  await page.waitForTimeout(400);
  const exit = await page.evaluate(async () => {
    document.querySelector('.ww-choice-close').click();
    await new Promise(requestAnimationFrame);
    const panel = document.querySelector('.ww-choice-panel');
    const duration = panel?.getAnimations()[0]?.effect.getTiming().duration;
    return { retained: !!panel, animated: !!panel?.getAnimations().length, duration };
  });
  check('sheet animates before unmount', exit.retained && exit.animated, exit);
  check('sheet exit uses the shared duration', exit.duration >= 160 && exit.duration <= 200, exit.duration);
  await page.waitForTimeout(400);
  check('sheet finishes closing', await page.getByRole('dialog').count() === 0);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await nav.getByRole('button', { name: '今日', exact: true }).click();
  await page.waitForTimeout(50);
  check('reduced motion disables page animations', await page.evaluate(() => !document.querySelector('#main-content').getAnimations({ subtree: true }).length));
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  return JSON.stringify({ pass: checks.every(row => row.pass), checks });
}
