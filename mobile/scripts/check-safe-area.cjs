async page => {
  const checks = [], errors = [];
  const check = (name, pass, detail) => checks.push({name, pass, detail});
  const original = await page.evaluate(() => {
    const saved = JSON.parse(localStorage.getItem('wordweave-mobile-state-v1') || 'null');
    if (JSON.parse(saved?.stateJson || 'null')?.user?.userId !== 'preview') throw Error('Safe area checks require the isolated preview account.');
    return {style: document.documentElement.getAttribute('style'), theme: localStorage.getItem('wordweave-mobile-theme')};
  });
  const viewport = page.viewportSize();
  const onError = error => errors.push(error.message);
  const settle = () => page.waitForTimeout(450);
  const insets = async values => {
    await page.evaluate(values => {
      for (const [side, px] of Object.entries(values)) document.documentElement.style.setProperty('--safe-area-inset-' + side, px + 'px');
      window.scrollTo(0, 0);
    }, values);
    await settle();
  };
  const nav = page.getByRole('navigation', {name: '主导航'});
  page.on('pageerror', onError);
  try {
    await nav.getByRole('button', {name: '我的', exact: true}).click();
    await settle();
    const cases = [
      {name: 'compact', width: 320, height: 640, top: 24, right: 0, bottom: 24, left: 0},
      {name: 'notch', width: 360, height: 800, top: 48, right: 0, bottom: 24, left: 0},
      {name: 'tall-cutout', width: 393, height: 852, top: 64, right: 0, bottom: 34, left: 0},
      {name: 'wide-phone', width: 430, height: 932, top: 36, right: 0, bottom: 48, left: 0},
      {name: 'landscape-left', width: 852, height: 393, top: 24, right: 0, bottom: 24, left: 64},
      {name: 'landscape-right', width: 852, height: 393, top: 24, right: 64, bottom: 24, left: 0},
      {name: 'tablet', width: 1280, height: 800, top: 32, right: 0, bottom: 24, left: 0},
      {name: 'native-padding-fallback', width: 393, height: 754, top: 0, right: 0, bottom: 0, left: 0},
    ];
    for (const item of cases) {
      await page.setViewportSize({width: item.width, height: item.height});
      await insets({top: item.top, right: item.right, bottom: item.bottom, left: item.left});
      const geometry = await page.evaluate(() => {
        const rect = selector => {const r = document.querySelector(selector).getBoundingClientRect(); return {x: r.x, y: r.y, right: r.right, bottom: r.bottom};};
        const content = getComputedStyle(document.querySelector('.app-content'));
        return {brand: rect('.app-brand'), sync: rect('.app-sync'), first: rect('.app-bottom-nav button:first-child'), last: rect('.app-bottom-nav button:last-child'), contentBottom: parseFloat(content.paddingBottom), navHeight: document.querySelector('.app-bottom-nav').getBoundingClientRect().height, overflow: document.documentElement.scrollWidth > innerWidth};
      });
      check(item.name + ': header and navigation avoid system bars and cutouts', !geometry.overflow && geometry.brand.y >= item.top && geometry.brand.x >= item.left + 10 && geometry.sync.right <= item.width - item.right - 10 && geometry.first.x >= item.left && geometry.last.right <= item.width - item.right && geometry.last.bottom <= item.height - item.bottom && geometry.contentBottom > geometry.navHeight + 12, geometry);
      await page.getByRole('button', {name: '编辑个人资料', exact: true}).click();
      await settle();
      const dialog = page.getByRole('dialog', {name: '编辑个人资料', exact: true});
      const bounds = await dialog.boundingBox();
      const close = await dialog.getByRole('button', {name: '关闭详情', exact: true}).boundingBox();
      check(item.name + ': editor fits the available height and keeps close button safe', bounds.y >= item.top && bounds.x >= item.left && bounds.x + bounds.width <= item.width - item.right && bounds.y + bounds.height <= item.height + 1 && close.y >= item.top, {bounds, close});
      await dialog.getByRole('button', {name: '保存资料', exact: true}).scrollIntoViewIfNeeded();
      const save = await dialog.getByRole('button', {name: '保存资料', exact: true}).boundingBox();
      check(item.name + ': save remains reachable above the navigation area', save.y >= item.top && save.y + save.height <= item.height - item.bottom, save);
      await dialog.getByRole('button', {name: '关闭详情', exact: true}).click();
      await dialog.waitFor({state: 'detached'});
    }
    await page.setViewportSize({width: 393, height: 852});
    await insets({top: 56, right: 0, bottom: 34, left: 0});
    await page.getByRole('button', {name: '编辑个人资料', exact: true}).click();
    await settle();
    const editor = page.getByRole('dialog', {name: '编辑个人资料', exact: true});
    // Resize an already open panel, as rotation / IME changes do on Android.
    await page.setViewportSize({width: 393, height: 430});
    await insets({top: 56, right: 0, bottom: 0, left: 0});
    await editor.getByRole('button', {name: '保存资料', exact: true}).scrollIntoViewIfNeeded();
    const keyboardSave = await editor.getByRole('button', {name: '保存资料', exact: true}).boundingBox();
    check('open editor adapts to keyboard-sized viewport without stale bottom inset', keyboardSave.y >= 56 && keyboardSave.y + keyboardSave.height <= 430, keyboardSave);
    await page.setViewportSize({width: 852, height: 393});
    await insets({top: 24, right: 64, bottom: 24, left: 0});
    await editor.getByRole('button', {name: '关闭详情', exact: true}).scrollIntoViewIfNeeded();
    const rotated = await editor.boundingBox();
    check('open editor adapts to rotation without reopening', rotated.y >= 24 && rotated.x + rotated.width <= 788 && rotated.y + rotated.height <= 369, rotated);
    await editor.getByRole('button', {name: '关闭详情', exact: true}).click();
    await editor.waitFor({state: 'detached'});
    await page.getByRole('button', {name: '学习偏好', exact: true}).click();
    await settle();
    await page.getByRole('button', {name: /^外观：/}).click();
    await settle();
    const choice = page.getByRole('dialog', {name: '选择外观', exact: true});
    const choiceBounds = await choice.boundingBox();
    check('appearance picker fits landscape safe area', choiceBounds.y >= 24 && choiceBounds.x + choiceBounds.width <= 788 && choiceBounds.y + choiceBounds.height <= 369, choiceBounds);
    await choice.getByRole('radio', {name: /深色/}).click();
    await choice.getByRole('button', {name: /确认/}).click();
    await choice.waitFor({state: 'detached'});
    await page.reload();
    await nav.waitFor();
    const dark = await page.evaluate(() => ({background: getComputedStyle(document.documentElement).backgroundColor, body: getComputedStyle(document.body).backgroundColor, theme: document.querySelector('meta[name="theme-color"]').content}));
    check('saved dark theme uses the same page and full-window background after reload', dark.background === 'rgb(25, 40, 32)' && dark.body === dark.background && dark.theme === '#192820', dark);
    await page.setViewportSize({width: 393, height: 852});
    await insets({top: 56, right: 0, bottom: 34, left: 0});
    await nav.getByRole('button', {name: '我的', exact: true}).click();
    await settle();
    await page.screenshot({path: 'output/playwright/safe-area-dark-393.png', animations: 'disabled'});
    check('no runtime errors', errors.length === 0, errors);
  } finally {
    page.off('pageerror', onError);
    await page.evaluate(original => {
      if (original.style === null) document.documentElement.removeAttribute('style');
      else document.documentElement.setAttribute('style', original.style);
      if (original.theme === null) localStorage.removeItem('wordweave-mobile-theme');
      else localStorage.setItem('wordweave-mobile-theme', original.theme);
    }, original);
    if (viewport) await page.setViewportSize(viewport);
    await page.reload();
  }
  return JSON.stringify({pass: checks.every(item => item.pass), checks});
}
