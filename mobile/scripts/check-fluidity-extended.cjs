async (page) => {
  const checks = [], errors = [];
  const check = (name, pass, detail) => checks.push({ name, pass, detail });
  const error = value => errors.push(value.message);
  page.on('pageerror', error);
  await page.evaluate(() => localStorage.setItem('wordweave-mobile-theme', 'light'));
  await page.reload();
  const nav = page.getByRole('navigation', { name: '主导航' });
  const chooseTab = async name => { await nav.getByRole('button', { name, exact: true }).click(); await page.waitForTimeout(400); };
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.setViewportSize({ width: 393, height: 852 });
  await chooseTab('阅读');
  await page.getByRole('button', { name: '打开阅读目录' }).click();
  await page.locator('.ww-directory-list > button').nth(3).click();
  await page.waitForTimeout(400);
  const title = await page.locator('.ww-reading-paper h2').innerText();
  await chooseTab('记录'); await chooseTab('阅读');
  check('selected reading survives tab change', await page.locator('.ww-reading-paper h2').innerText() === title);
  await page.locator('.ww-word-link').first().click();
  const sheet = page.getByRole('dialog', { name: '词条详情' });
  await sheet.getByRole('textbox', { name: '这个词的个人联想' }).fill('fluidity draft stays local');
  await sheet.getByRole('button', { name: /^熟悉程度：/ }).click();
  await page.evaluate(() => window.dispatchEvent(new Event('ww:back', { cancelable: true })));
  await page.waitForTimeout(400);
  check('back closes only the nested picker', await sheet.count() === 1 && await page.locator('.ww-choice-panel').count() === 0);
  check('nested back keeps note draft', await sheet.getByRole('textbox', { name: '这个词的个人联想' }).inputValue() === 'fluidity draft stays local');
  check('nested back keeps body locked', await page.evaluate(() => document.body.style.overflow === 'hidden'));
  await page.evaluate(() => window.dispatchEvent(new Event('ww:back', { cancelable: true })));
  await page.waitForTimeout(400);
  check('last overlay releases body and focus', await page.evaluate(() => document.body.style.overflow !== 'hidden' && document.activeElement?.classList.contains('ww-word-link')));

  // Interrupt an opening at a known animation time, then compare the exit's first keyframe.
  await page.getByRole('button', { name: /^学习词表：/ }).click();
  const interrupted = await page.evaluate(async () => {
    const panel = document.querySelector('.ww-choice-panel');
    const opening = panel.getAnimations()[0];
    if (!opening) return { pass: false, reason: 'no opening animation' };
    opening.pause(); opening.currentTime = 45;
    await new Promise(requestAnimationFrame);
    const before = getComputedStyle(panel).transform;
    document.querySelector('.ww-choice-close').click();
    await new Promise(requestAnimationFrame);
    const exit = panel.getAnimations()[0];
    return { pass: before !== 'matrix(1, 0, 0, 1, 0, 0)' && exit?.effect.getKeyframes()[0].transform === before, before, from: exit?.effect.getKeyframes()[0].transform };
  });
  check('interrupted opening closes from its current position', interrupted.pass, interrupted);
  await page.waitForTimeout(400);

  await chooseTab('词库');
  await page.getByRole('searchbox', { name: '搜索英文单词或中文释义' }).fill('');
  await page.getByRole('button', { name: '快速浏览', exact: true }).click();
  await page.waitForTimeout(400);
  check('practice replaces page and hides navigation', await nav.count() === 0 && await page.locator('.ww-browse-card').isVisible());
  await page.getByRole('button', { name: '下一个', exact: true }).click();
  await page.evaluate(() => {
    window.__practiceExit = [];
    window.__practiceObserver = new MutationObserver(() => {
      const active = document.querySelector('.app-view[data-active]')?.dataset.page;
      if (active) window.__practiceExit.push(active);
    });
    window.__practiceObserver.observe(document.querySelector('#main-content'), { subtree: true, attributes: true, childList: true });
  });
  await page.getByRole('button', { name: '结束浏览', exact: true }).click();
  await page.waitForTimeout(400);
  const exitPages = await page.evaluate(() => { window.__practiceObserver.disconnect(); return window.__practiceExit; });
  check('practice exits directly to today without flashing the source tab', exitPages.every(id => id === 'today'), exitPages);
  check('practice exit restores today and level picker', await nav.getByRole('button', { name: '今日', exact: true }).getAttribute('aria-current') === 'page' && await page.getByRole('button', { name: /^学习词表：/ }).isVisible());

  const rapid = await page.evaluate(async () => {
    const buttons = [...document.querySelectorAll('.app-bottom-nav button')];
    for (let i = 0; i < 20; i++) { buttons[i % 5].click(); await new Promise(requestAnimationFrame); }
    await new Promise(resolve => setTimeout(resolve, 350));
    return { selected: document.querySelector('.app-bottom-nav [aria-current="page"]')?.getAttribute('aria-label'), active: [...document.querySelectorAll('.app-view[data-active]')].map(node => node.dataset.page), exiting: document.querySelectorAll('.app-view[data-exiting]').length, animated: document.querySelector('#main-content').getAnimations({ subtree: true }).length };
  });
  check('rapid taps settle on latest tab without residual animation', rapid.selected === '我的' && rapid.active.join() === 'my' && rapid.exiting === 0 && rapid.animated === 0, rapid);

  await page.getByRole('button', { name: '学习偏好', exact: true }).click();
  await page.waitForTimeout(400);
  await page.getByRole('button', { name: /^外观：/ }).click();
  await page.getByRole('radio', { name: /深色/ }).click();
  await page.getByRole('button', { name: '确认选择' }).click();
  await page.waitForTimeout(400);
  check('picker confirms once and restores scrolling', await page.evaluate(() => document.documentElement.classList.contains('dark') && document.body.style.overflow !== 'hidden'));
  await page.setViewportSize({ width: 320, height: 640 });
  check('narrow screen has no horizontal overflow', await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.screenshot({ path: 'output/playwright/fluidity-dark-320.png' });
  await page.setViewportSize({ width: 393, height: 852 });
  await page.getByRole('button', { name: /^外观：/ }).click();
  await page.getByRole('radio', { name: /浅色/ }).click();
  await page.getByRole('button', { name: '确认选择' }).click();
  await page.waitForTimeout(400);
  await chooseTab('今日');
  await page.screenshot({ path: 'output/playwright/fluidity-light-393.png' });
  await page.getByRole('button', { name: /^学习词表：/ }).click();
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.getByRole('button', { name: '取消选择' }).click();
  check('reduced motion closes without waiting for animation', await page.locator('.ww-choice-panel').count() === 0);
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  check('no runtime exceptions', errors.length === 0, errors);
  page.off('pageerror', error);
  return JSON.stringify({ pass: checks.every(row => row.pass), checks });
}
