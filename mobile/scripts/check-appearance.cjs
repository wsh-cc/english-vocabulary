async page => {
  const checks = [], errors = [];
  const check = (name, pass, detail) => checks.push({name, pass, detail});
  const original = await page.evaluate(() => {
    const raw = localStorage.getItem('wordweave-mobile-state-v1');
    if (JSON.parse(JSON.parse(raw || 'null')?.stateJson || 'null')?.user?.userId !== 'preview') throw Error('Appearance checks require the isolated preview account.');
    return {theme: localStorage.getItem('wordweave-mobile-theme'), font: document.documentElement.style.fontSize};
  });
  const viewport = page.viewportSize();
  const settle = () => page.waitForTimeout(400);
  const nav = page.getByRole('navigation', {name: '主导航'});
  const chooseTab = async name => {await nav.getByRole('button', {name, exact: true}).click(); await settle();};
  const openAppearance = async () => {await chooseTab('我的'); await page.getByRole('button', {name: '主题外观', exact: true}).click(); await settle();};
  const theme = name => page.getByRole('radio', {name, exact: true});
  const onError = error => errors.push(error.message);
  page.on('pageerror', onError);
  try {
    await page.emulateMedia({colorScheme: 'dark', reducedMotion: 'no-preference'});
    await page.evaluate(() => localStorage.setItem('wordweave-mobile-theme', 'dark'));
    await page.reload();
    await openAppearance();
    check('My offers a dedicated appearance page with three accessible choices', await page.locator('.app-view[data-active]').getAttribute('data-page') === 'my-appearance' && await page.getByRole('radiogroup', {name: '主题外观'}).getByRole('radio').count() === 3);
    const before = await page.evaluate(() => localStorage.getItem('wordweave-mobile-state-v1'));
    await theme('纸白 · 浅色').click();
    await settle();
    const light = await page.evaluate(() => ({dark: document.documentElement.classList.contains('dark'), stored: localStorage.getItem('wordweave-mobile-theme'), bg: getComputedStyle(document.documentElement).backgroundColor, body: getComputedStyle(document.body).backgroundColor, meta: document.querySelector('meta[name="theme-color"]').content, state: localStorage.getItem('wordweave-mobile-state-v1')}));
    check('white theme applies immediately even when the OS is dark and preserves learning data', !light.dark && light.stored === 'light' && light.bg === 'rgb(246, 247, 244)' && light.body === light.bg && light.meta === '#f6f7f4' && light.state === before, {...light, state: undefined});
    check('theme choice is announced and only the selected radio enters tab order', await theme('纸白 · 浅色').getAttribute('aria-checked') === 'true' && await page.locator('.appearance-options [tabindex="0"]').count() === 1 && await page.getByRole('status').filter({hasText: '已选择纸白'}).count() === 1);
    for (const size of [{width:320,height:640},{width:393,height:852},{width:852,height:393}]) {
      await page.setViewportSize(size); await settle();
      const fit = await page.evaluate(() => ({overflow: document.documentElement.scrollWidth > innerWidth, buttons: [...document.querySelectorAll('.appearance-option')].map(node => {const r=node.getBoundingClientRect();return r.width>=44 && r.height>=44 && r.left>=0 && r.right<=innerWidth;})}));
      check(`theme previews fit ${size.width} px with usable touch targets`, !fit.overflow && fit.buttons.every(Boolean), fit);
    }
    await page.setViewportSize({width:320,height:640});
    await page.evaluate(() => {document.documentElement.style.fontSize='125%';});
    await settle();
    check('theme labels remain in bounds at 320 px with enlarged type', await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth && [...document.querySelectorAll('.appearance-option')].every(node=>node.scrollWidth<=node.clientWidth+1)));
    await page.evaluate(font => {document.documentElement.style.fontSize=font;}, original.font);
    await page.setViewportSize({width:393,height:852});
    await theme('纸白 · 浅色').focus();
    await page.keyboard.press('ArrowRight'); await settle();
    check('keyboard selects deep green and updates selection', await theme('深绿 · 深色').getAttribute('aria-checked') === 'true' && await page.evaluate(() => document.documentElement.classList.contains('dark')));
    await page.keyboard.press('Home'); await settle();
    await page.evaluate(() => window.scrollTo(0,0));
    await page.screenshot({path:'output/playwright/appearance-white-393.png', animations:'disabled', fullPage:true});
    await theme('纸白 · 浅色').click();
    await page.setViewportSize({width:393,height:1100});
    await page.getByRole('heading',{name:'主题外观',exact:true}).click();
    await page.locator('.personal-detail').screenshot({path:'output/playwright/appearance-white-preview.png',animations:'disabled'});
    await page.setViewportSize({width:393,height:852});
    await page.reload();
    await nav.waitFor();
    check('white theme survives a reload independently of system darkness', await page.evaluate(() => !document.documentElement.classList.contains('dark') && localStorage.getItem('wordweave-mobile-theme')==='light'));

    const contrast = await page.evaluate(() => {
      const css = getComputedStyle(document.documentElement);
      const luminance = value => {const hex=value.trim().replace('#',''); const rgb=[0,2,4].map(i=>parseInt(hex.slice(i,i+2),16)/255).map(n=>n<=.04045?n/12.92:((n+.055)/1.055)**2.4);return rgb[0]*.2126+rgb[1]*.7152+rgb[2]*.0722;};
      const ratio=(a,b)=>{const x=luminance(css.getPropertyValue(a)),y=luminance(css.getPropertyValue(b));return (Math.max(x,y)+.05)/(Math.min(x,y)+.05);};
      return ['--app-ink','--app-muted','--app-green'].flatMap(color=>['--app-bg','--app-paper','--app-tint'].map(background=>({color,background,ratio:ratio(color,background)})));
    });
    check('body, secondary and accent text contrast stays at least 4.5 to 1 on white-theme surfaces', contrast.every(item=>item.ratio>=4.5), contrast);
    for (const name of ['今日','阅读','词库','记录','我的']) {
      await chooseTab(name);
      const colors=await page.evaluate(() => ({dark:document.documentElement.classList.contains('dark'), app:getComputedStyle(document.documentElement).getPropertyValue('--app-paper').trim(), study:getComputedStyle(document.documentElement).getPropertyValue('--ww-paper').trim(), overflow:document.documentElement.scrollWidth>innerWidth}));
      check(name + ': cached page inherits the white palette without overflow', !colors.dark && colors.app==='#fdfdfb' && colors.study===colors.app && !colors.overflow,colors);
      if(['今日','我的'].includes(name)) await page.screenshot({path:`output/playwright/appearance-${name==='今日'?'today':'my'}-white-393.png`,animations:'disabled',fullPage:true});
    }
    await page.getByRole('button',{name:'编辑个人资料',exact:true}).click(); await settle();
    const editor=page.getByRole('dialog',{name:'编辑个人资料',exact:true});
    const editorStyle=await editor.evaluate(node=>({background:getComputedStyle(node).backgroundColor,input:getComputedStyle(node.querySelector('input:not([hidden])')).backgroundColor,hidden:getComputedStyle(node.querySelector('input[type="file"]')).display}));
    check('editor uses white surfaces and retains the hidden photo input',editorStyle.background==='rgb(253, 253, 251)'&&editorStyle.input==='rgb(246, 247, 244)'&&editorStyle.hidden==='none',editorStyle);
    await page.screenshot({path:'output/playwright/appearance-editor-white-393.png',animations:'disabled'});
    await editor.getByRole('button',{name:'关闭详情',exact:true}).click(); await editor.waitFor({state:'detached'});
    await page.getByRole('button',{name:'我的好友',exact:true}).click();await settle();
    check('friends page shares the white palette',await page.locator('.friends-card').first().evaluate(node=>getComputedStyle(node).backgroundColor==='rgb(253, 253, 251)'));
    await page.getByRole('button',{name:'返回个人主页',exact:true}).click();await settle();
    await page.getByRole('button',{name:'学习偏好',exact:true}).click();await settle();
    check('existing settings entry reflects the same white theme',await page.getByRole('button',{name:'外观：纸白 · 浅色',exact:true}).count()===1);
    await page.getByRole('button',{name:'返回个人主页',exact:true}).click();await settle();
    await page.getByRole('button',{name:'主题外观',exact:true}).click();await settle();
    await theme('跟随系统').click();await settle();
    check('system option follows dark system appearance',await page.evaluate(()=>document.documentElement.classList.contains('dark')&&localStorage.getItem('wordweave-mobile-theme')==='system'));
    await page.emulateMedia({colorScheme:'light'});await settle();
    check('system option reacts to OS appearance change without reopening',await page.evaluate(()=>!document.documentElement.classList.contains('dark')));
    await page.emulateMedia({reducedMotion:'reduce'});
    await theme('深绿 · 深色').click();await settle();
    check('explicit deep green overrides a light system with reduced motion enabled',await page.evaluate(()=>document.documentElement.classList.contains('dark')&&document.querySelector('meta[name="theme-color"]').content==='#192820'));
    await page.getByRole('button',{name:'返回个人主页',exact:true}).click();await settle();
    check('return restores focus to appearance entry and releases detail page',await page.getByRole('button',{name:'主题外观',exact:true}).evaluate(node=>node===document.activeElement)&&await page.locator('.app-view[data-page="my-appearance"]').count()===0);
    check('no appearance runtime errors',errors.length===0,errors);
  } finally {
    page.off('pageerror',onError);
    await page.evaluate(original=>{if(original.theme===null)localStorage.removeItem('wordweave-mobile-theme');else localStorage.setItem('wordweave-mobile-theme',original.theme);document.documentElement.style.fontSize=original.font;},original);
    await page.emulateMedia({colorScheme:'light',reducedMotion:'no-preference'});
    if(viewport)await page.setViewportSize(viewport);
    await page.reload();
  }
  return JSON.stringify({pass:checks.every(check=>check.pass),checks});
}
