async page => {
  await page.setViewportSize({width:393,height:852});
  const dialog=page.getByRole('dialog',{name:'编辑个人资料',exact:true});
  await dialog.waitFor();
  const samples=[];
  for(const name of ['首字','书页','新芽','晨光','远山','咖啡']){
    const button=dialog.getByRole('radio',{name,exact:true});
    await button.scrollIntoViewIfNeeded();
    const box=await button.boundingBox();
    await page.mouse.move(box.x+box.width/2,box.y+box.height/2);
    await page.mouse.down();
    await page.waitForTimeout(30);
    samples.push(await dialog.evaluate(node=>{const box=node.getBoundingClientRect(),style=getComputedStyle(node);return {radius:style.borderTopLeftRadius,rightRadius:style.borderTopRightRadius,scrollTop:node.scrollTop,overflow:style.overflowY,cornerHitInside:node.contains(document.elementFromPoint(box.left+1,box.top+1)),top:box.top};}));
    await page.mouse.up();
    await page.waitForTimeout(160);
  }
  return JSON.stringify({pass:samples.every(s=>s.radius==='25px'&&s.rightRadius==='25px'&&!s.cornerHitInside),samples});
}
