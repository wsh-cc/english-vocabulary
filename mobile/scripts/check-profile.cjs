async page => {
  const checks = [], errors = [];
  const check = (name, pass, detail) => checks.push({name, pass, detail});
  const onError = error => errors.push(error.message);
  const stateKey = 'wordweave-mobile-state-v1';
  // This script may alter storage only after verifying the disposable preview account.
  const original = await page.evaluate(key => {
    const raw = localStorage.getItem(key);
    const saved = raw && JSON.parse(raw);
    const envelope = saved?.stateJson && JSON.parse(saved.stateJson);
    if (envelope?.user?.userId !== 'preview') throw Error('Profile checks require the isolated preview account.');
    return {raw, name: envelope.user.name, theme: localStorage.getItem('wordweave-mobile-theme'), font: document.documentElement.style.fontSize};
  }, stateKey);
  const viewport = page.viewportSize();
  const nav = page.getByRole('navigation', {name: '主导航'});
  const editor = page.getByRole('dialog', {name: '编辑个人资料', exact: true});
  const settle = () => page.waitForTimeout(400);
  const chooseTab = async name => { await nav.getByRole('button', {name, exact: true}).click(); await settle(); };
  const activePage = () => page.locator('.app-view[data-active]').getAttribute('data-page');
  const openEditor = async () => { await page.getByRole('button', {name: '编辑个人资料', exact: true}).click(); await settle(); };
  const closeEditor = async () => { await editor.getByRole('button', {name: '关闭详情', exact: true}).click(); await settle(); };
  const backHome = async () => { await page.getByRole('button', {name: '返回个人主页', exact: true}).click(); await settle(); };
  const savedEnvelope = () => page.evaluate(key => JSON.parse(JSON.parse(localStorage.getItem(key)).stateJson), stateKey);
  const restoreStorageMethod = () => page.evaluate(() => {
    if (window.__profileOriginalSetItem) {
      Storage.prototype.setItem = window.__profileOriginalSetItem;
      delete window.__profileOriginalSetItem;
    }
  });
  const watchDetailExits = () => page.evaluate(() => {
    window.__profileAnimationCancel = Animation.prototype.cancel;
    window.__profileExitSamples = [];
    Animation.prototype.cancel = function() {
      const target = this.effect?.target;
      const detailExit = target instanceof HTMLElement && target.matches('.app-view[data-exiting][data-page^="my-"]') && this.playState === 'finished';
      const before = detailExit ? Number(getComputedStyle(target).opacity) : 0;
      window.__profileAnimationCancel.call(this);
      if (detailExit) window.__profileExitSamples.push({page: target.dataset.page, before, after: Number(getComputedStyle(target).opacity), display: getComputedStyle(target).display});
    };
  });
  page.on('pageerror', onError);
  try {
    await page.setViewportSize({width: 393, height: 852});
    await page.emulateMedia({reducedMotion: 'no-preference'});
    await chooseTab('我的');
    const menus = ['编辑个人资料', '学习偏好', '同步与账号', '数据与备份', '关于词间'];
    const visibleMenus = await Promise.all(menus.map(name => page.getByRole('button', {name, exact: true}).isVisible()));
    check('personal home presents every entry without exposing detail-page controls', visibleMenus.every(Boolean) && await page.getByRole('button', {name: '恢复备份', exact: true}).count() === 0, visibleMenus);
    await page.screenshot({path: 'output/playwright/profile-home-393.png'});

    await openEditor();
    check('editor explains local profile storage and explicit sharing', await editor.getByText('先保存在此设备', {exact: false}).count() > 0);
    await editor.getByRole('textbox', {name: '昵称', exact: true}).fill('青禾测试');
    await editor.getByRole('textbox', {name: '个人签名', exact: true}).fill('每天读一点，让记忆慢慢生长。');
    await editor.getByRole('radio', {name: '新芽', exact: true}).click();
    await closeEditor();
    await openEditor();
    check('closing and reopening keeps all unsaved profile fields', await editor.getByRole('textbox', {name: '昵称', exact: true}).inputValue() === '青禾测试' && await editor.getByRole('textbox', {name: '个人签名', exact: true}).inputValue() === '每天读一点，让记忆慢慢生长。' && await editor.getByRole('radio', {name: '新芽', exact: true}).getAttribute('aria-checked') === 'true');

    const beforeFailure = await savedEnvelope();
    await page.evaluate(key => {
      window.__profileOriginalSetItem = Storage.prototype.setItem;
      Storage.prototype.setItem = function(name, value) {
        if (name === key) throw new DOMException('Profile storage test failure', 'QuotaExceededError');
        return window.__profileOriginalSetItem.call(this, name, value);
      };
    }, stateKey);
    try {
      await editor.getByRole('button', {name: '保存资料', exact: true}).click();
      await page.waitForFunction(() => document.body.textContent.includes('Profile storage test failure'));
      const afterFailure = await savedEnvelope();
      check('storage failure preserves the saved profile and edit draft without claiming success', JSON.stringify(afterFailure.localProfile) === JSON.stringify(beforeFailure.localProfile) && await editor.count() === 1 && await editor.getByRole('textbox', {name: '昵称', exact: true}).inputValue() === '青禾测试' && await page.getByText('个人资料已保存到此设备。', {exact: true}).count() === 0);
    } finally {
      await restoreStorageMethod();
    }
    await editor.getByRole('button', {name: '保存资料', exact: true}).click();
    await editor.waitFor({state: 'detached'});
    check('successful retry reports durable save', await page.getByText('个人资料已保存到此设备。', {exact: true}).isVisible());
    const saved = await savedEnvelope();
    check('profile save stores avatar and text without changing username or queued learning work', saved.localProfile?.nickname === '青禾测试' && saved.localProfile?.signature === '每天读一点，让记忆慢慢生长。' && saved.localProfile?.avatar === 'sprout' && saved.user.name === original.name && JSON.stringify(saved.outbox) === JSON.stringify(beforeFailure.outbox));

    await page.reload();
    await watchDetailExits();
    await chooseTab('我的');
    await openEditor();
    check('profile survives reload with selected avatar', await editor.getByRole('textbox', {name: '昵称', exact: true}).inputValue() === '青禾测试' && await editor.getByRole('textbox', {name: '个人签名', exact: true}).inputValue() === '每天读一点，让记忆慢慢生长。' && await editor.getByRole('radio', {name: '新芽', exact: true}).getAttribute('aria-checked') === 'true');
    await closeEditor();

    await page.evaluate(() => window.scrollTo(0, 180));
    const homeScroll = await page.evaluate(() => scrollY);
    await page.getByRole('button', {name: '学习偏好', exact: true}).click();
    await settle();
    check('preferences open as a temporary detail page', await activePage() === 'my-settings');
    const detailFocused = await page.evaluate(() => document.activeElement === document.querySelector('.app-view[data-active] .personal-detail-heading h1'));
    await page.getByRole('button', {name: /^外观：/}).click();
    await settle();
    await page.evaluate(() => window.dispatchEvent(new Event('ww:back', {cancelable: true})));
    await settle();
    check('back closes nested picker before leaving preferences', await activePage() === 'my-settings' && await page.locator('.ww-choice-panel').count() === 0 && await page.evaluate(() => document.body.style.overflow !== 'hidden'));
    await backHome();
    const restoredScroll = await page.evaluate(() => scrollY);
    check('returning to home restores its scroll and releases the detail page', await activePage() === 'my' && Math.abs(restoredScroll - homeScroll) < 2 && await page.locator('.app-view[data-page="my-settings"]').count() === 0, {homeScroll, restoredScroll});
    const restoredFocus = await page.evaluate(() => document.activeElement?.getAttribute('aria-label'));
    check('detail navigation focuses its heading then restores the originating home entry without scrolling', detailFocused && restoredFocus === '学习偏好' && Math.abs(restoredScroll - homeScroll) < 2, {detailFocused, restoredFocus, homeScroll, restoredScroll});

    await page.getByRole('button', {name: '数据与备份', exact: true}).click();
    await settle();
    check('data page retains backup and vocabulary import entry points', await activePage() === 'my-data' && await page.getByRole('button', {name: '导出完整备份', exact: true}).isVisible() && await page.getByRole('button', {name: '恢复备份', exact: true}).isVisible() && await page.getByRole('button', {name: '选择 JSON 词表', exact: true}).isVisible());
    await chooseTab('今日');
    await chooseTab('我的');
    check('leaving the My tab resets its detail navigation', await activePage() === 'my' && await page.locator('.app-view[data-page="my-data"]').count() === 0);
    await chooseTab('今日');
    await page.getByRole('button', {name: '查看同步状态', exact: true}).click();
    await settle();
    check('header sync status opens the sync detail directly', await activePage() === 'my-sync' && await page.getByRole('button', {name: '立即同步', exact: true}).isVisible());
    await backHome();
    await chooseTab('词库');
    await page.getByRole('button', {name: '快速浏览', exact: true}).click();
    await settle();
    await page.getByRole('button', {name: '查看同步状态', exact: true}).click();
    await settle();
    check('header sync exits active practice and restores bottom navigation', await activePage() === 'my-sync' && await nav.isVisible() && await nav.getByRole('button', {name: '我的', exact: true}).getAttribute('aria-current') === 'page' && await page.locator('.ww-session').count() === 0);
    await backHome();
    await page.getByRole('button', {name: '关于词间', exact: true}).click();
    await settle();
    check('about page opens through the same detail navigation', await activePage() === 'my-about');
    await backHome();

    for (let i = 0; i < 12; i++) {
      await page.getByRole('button', {name: i % 2 ? '学习偏好' : '关于词间', exact: true}).click();
      await backHome();
    }
    check('repeated detail visits leave only the five cached primary pages', await page.locator('.app-view').count() === 5 && await page.locator('.app-view[data-page^="my-"]').count() === 0 && await page.evaluate(() => document.querySelector('#main-content').getAnimations({subtree: true}).length === 0));
    const exitSamples = await page.evaluate(() => window.__profileExitSamples);
    check('finished profile detail exits never flash back when animation is released', exitSamples.length > 0 && exitSamples.every(sample => sample.before >= .01 || sample.after <= .01 || sample.display === 'none'), exitSamples);

    await page.getByRole('button', {name: '学习偏好', exact: true}).click();
    await settle();
    await page.getByRole('button', {name: /^外观：/}).click();
    await page.getByRole('radio', {name: /深色/}).click();
    await page.getByRole('button', {name: '确认选择', exact: true}).click();
    await settle();
    await backHome();
    await page.setViewportSize({width: 320, height: 640});
    await page.evaluate(() => {document.documentElement.style.fontSize = '125%';});
    await settle();
    check('dark home at 320 px and 125 percent type has no horizontal overflow', await page.evaluate(() => document.documentElement.classList.contains('dark') && document.documentElement.scrollWidth <= innerWidth));
    await page.screenshot({path: 'output/playwright/profile-dark-320-large-type.png', fullPage: true});
    await openEditor();
    check('profile editor at 320 px and 125 percent type stays inside the viewport', await page.evaluate(() => {const dialog = document.querySelector('[role="dialog"][aria-label="编辑个人资料"]');const box = dialog?.getBoundingClientRect();return !!box && box.left >= -1 && box.right <= innerWidth + 1 && dialog.scrollWidth <= dialog.clientWidth + 1;}));
    await page.screenshot({path: 'output/playwright/profile-editor-dark-320-large-type.png'});
    await page.emulateMedia({reducedMotion: 'reduce'});
    await editor.getByRole('button', {name: '关闭详情', exact: true}).click();
    await editor.waitFor({state: 'detached'});
    check('reduced motion closes profile editor and releases scrolling', await page.evaluate(() => document.body.style.overflow !== 'hidden' && document.querySelectorAll('.app-presence').length === 0));
    check('profile interactions raise no uncaught errors', errors.length === 0, errors);
  } finally {
    await restoreStorageMethod();
    await page.evaluate(({key, original}) => {
      if (window.__profileAnimationCancel) {
        Animation.prototype.cancel = window.__profileAnimationCancel;
        delete window.__profileAnimationCancel;
        delete window.__profileExitSamples;
      }
      const saved = JSON.parse(localStorage.getItem(key));
      if (JSON.parse(saved.stateJson).user?.userId !== 'preview') throw Error('Refusing to restore profile fixture over a real account.');
      localStorage.setItem(key, original.raw);
      if (original.theme === null) localStorage.removeItem('wordweave-mobile-theme');
      else localStorage.setItem('wordweave-mobile-theme', original.theme);
      document.documentElement.style.fontSize = original.font;
    }, {key: stateKey, original});
    await page.emulateMedia({reducedMotion: 'no-preference'});
    if (viewport) await page.setViewportSize(viewport);
    await page.reload();
    page.off('pageerror', onError);
  }
  return JSON.stringify({pass: checks.every(check => check.pass), checks});
}
