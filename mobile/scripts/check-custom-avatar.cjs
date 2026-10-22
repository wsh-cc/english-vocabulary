async page => {
  const key='wordweave-mobile-state-v1',checks=[];
  const check=(name,pass,detail)=>checks.push({name,pass,detail});
  const original=await page.evaluate(key=>{const value=localStorage.getItem(key);if(JSON.parse(JSON.parse(value).stateJson).user.userId!=='preview')throw Error('Isolated preview account required');return value;},key);
  const nav=()=>page.getByRole('navigation',{name:'主导航'}).getByRole('button',{name:'我的',exact:true});
  const editor=()=>page.getByRole('dialog',{name:'编辑个人资料',exact:true});
  try{
    await page.reload();await page.setViewportSize({width:393,height:852});await nav().click();
    await page.getByRole('button',{name:'编辑个人资料',exact:true}).click();await page.waitForTimeout(300);
    const token=await editor().evaluate(node=>{window.__avatarDialog=node;return true;});
    for(const name of ['书页','新芽','晨光','远山','咖啡','首字'])await editor().getByRole('radio',{name,exact:true}).click();
    check('avatar choices retain one stable sheet without restarting its entrance',token&&await editor().evaluate(node=>node===window.__avatarDialog&&getComputedStyle(node).borderTopLeftRadius==='25px'&&node.getAnimations().length===0));
    const image=await page.evaluate(()=>{const canvas=document.createElement('canvas');canvas.width=640;canvas.height=320;const ctx=canvas.getContext('2d');ctx.fillStyle='#678e63';ctx.fillRect(0,0,640,320);ctx.fillStyle='#f6efcf';ctx.beginPath();ctx.arc(320,160,100,0,Math.PI*2);ctx.fill();return canvas.toDataURL('image/png').split(',')[1];});
    await editor().getByLabel('选择头像照片',{exact:true}).setInputFiles({name:'avatar-test.png',mimeType:'image/png',buffer:Buffer.from(image,'base64')});
    await editor().locator('.personal-avatar img').waitFor();
    check('selected photo is cropped and bounded before saving',await editor().locator('.personal-avatar img').evaluate(async image=>{await image.decode();return image.naturalWidth===128&&image.naturalHeight===128&&image.src.startsWith('data:image/jpeg;base64,')&&image.src.length<=16384;}));
    await editor().getByRole('button',{name:'关闭详情',exact:true}).click();await editor().waitFor({state:'detached'});
    await page.getByRole('button',{name:'编辑个人资料',exact:true}).click();
    check('closing and reopening keeps the unsaved photo',await editor().locator('.personal-avatar img').count()===1);
    await editor().getByRole('button',{name:'保存资料',exact:true}).click();await editor().waitFor({state:'detached'});
    await page.reload();await nav().click();
    check('custom photo survives reload in the account profile',await page.locator('.personal-identity .personal-avatar img').count()===1&&await page.evaluate(key=>JSON.parse(JSON.parse(localStorage.getItem(key)).stateJson).localProfile.avatar==='custom',key));
    await page.getByRole('button',{name:'编辑个人资料',exact:true}).click();
    const before=await editor().locator('.personal-avatar img').getAttribute('src');
    await editor().getByLabel('选择头像照片',{exact:true}).setInputFiles({name:'broken.png',mimeType:'image/png',buffer:Buffer.from('invalid-image')});
    await editor().getByRole('alert').waitFor();
    check('invalid image keeps the previous photo and permits retry',await editor().locator('.personal-avatar img').getAttribute('src')===before&&await editor().getByRole('button',{name:'从手机选择照片',exact:true}).isEnabled());
    await page.setViewportSize({width:320,height:640});await page.evaluate(()=>document.documentElement.style.fontSize='125%');
    await editor().getByRole('textbox',{name:'个人签名',exact:true}).scrollIntoViewIfNeeded();
    check('only the inner content scrolls and both top corners stay clipped',await editor().evaluate(node=>{const scroller=node.querySelector('.ww-sheet-scroll'),box=node.getBoundingClientRect();return node.scrollTop===0&&scroller.scrollTop>0&&getComputedStyle(node).overflow==='hidden'&&!node.contains(document.elementFromPoint(box.left+1,box.top+1))&&node.scrollWidth<=node.clientWidth;}));
    await page.screenshot({path:'output/playwright/avatar-custom-320.png'});
  }finally{
    await page.evaluate(({key,original})=>{localStorage.setItem(key,original);document.documentElement.style.fontSize='';delete window.__avatarDialog;},{key,original});
    await page.setViewportSize({width:393,height:852});await page.reload();
  }
  return JSON.stringify({pass:checks.every(check=>check.pass),checks});
}
