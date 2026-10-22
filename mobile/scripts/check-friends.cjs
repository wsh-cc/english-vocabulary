async page => {
  const checks=[],errors=[],requests=[];
  const check=(name,pass,detail)=>checks.push({name,pass,detail});
  const stateKey='wordweave-mobile-state-v1',tokenKey='wordweave-preview-token';
  const original=await page.evaluate(({stateKey,tokenKey})=>{
    const raw=localStorage.getItem(stateKey),saved=raw&&JSON.parse(raw),envelope=saved?.stateJson&&JSON.parse(saved.stateJson);
    if(envelope?.user?.userId!=='preview')throw Error('Friends checks require the isolated preview account.');
    return {raw,token:sessionStorage.getItem(tokenKey),theme:localStorage.getItem('wordweave-mobile-theme'),font:document.documentElement.style.fontSize,dark:document.documentElement.classList.contains('dark')};
  },{stateKey,tokenKey});
  const viewport=page.viewportSize(),onError=error=>errors.push(error.message);
  const now=Date.now();
  const user=(userId,username,nickname,avatar='sprout')=>({userId,username,nickname,signature:'一起慢慢积累。',avatar});
  const ivy=user('friend-ivy','ivy-reader','青禾');
  const rain=user('friend-rain','rain-reader','雨禾','sun');
  const cloud=user('friend-cloud','cloud-reader','云朵','book');
  const old=user('friend-old','old-reader','待回应的朋友','mountain');
  const fresh=user('friend-fresh','new-reader','新芽同学');
  const slow=user('friend-slow','slow-reader','较慢的搜索结果','coffee');
  const people=[ivy,rain,cloud,old,fresh,slow];
  const overview={friends:[{user:ivy,since:now-86400000}],incoming:[{requestId:'incoming-rain',user:rain,createdAt:now-600000},{requestId:'incoming-cloud',user:cloud,createdAt:now-300000}],outgoing:[{requestId:'outgoing-old',user:old,createdAt:now-100000}],profile:{nickname:'',signature:'',avatar:'initial',shareLearning:false},published:false,serverTime:now};
  let listFailure=false,detailMode='open',detailDelay=0,hiddenStats=false,requestFailure=false,loseInviteResponse=false;
  let invites=[],inviteSequence=0;
  const inviteOperations=new Set();
  const headers={'content-type':'application/json','access-control-allow-origin':'*','access-control-allow-headers':'Authorization, Content-Type','access-control-allow-methods':'GET, POST, OPTIONS'};
  const fixtureRoute=async route=>{
    const request=route.request(),url=new URL(request.url());
    if(request.method()==='OPTIONS'){await route.fulfill({status:204,headers,body:''});return;}
    // Never allow this script's fake token or mutations to reach any real API.
    if(url.pathname!=='/api/mobile/friends'){await route.abort('blockedbyclient');return;}
    const reply=(data,status=200)=>route.fulfill({status,headers,body:JSON.stringify(data)});
    if(request.method()==='GET'){
      const view=url.searchParams.get('view');
      if(view==='list'){await reply(listFailure?{error:'好友列表暂时离线。',code:'offline'}:overview,listFailure?503:200);return;}
      if(view==='invites'){await reply({invites});return;}
      if(view==='search'){
        const username=url.searchParams.get('username'),found=people.find(person=>person.username===username)||null;
        if(username==='slow-reader')await new Promise(resolve=>setTimeout(resolve,350));
        const incoming=found&&overview.incoming.find(item=>item.user.userId===found.userId),outgoing=found&&overview.outgoing.find(item=>item.user.userId===found.userId);
        await reply({user:found,relationship:found&&overview.friends.some(item=>item.user.userId===found.userId)?'friend':incoming?'incoming':outgoing?'outgoing':'none',...(incoming||outgoing?{requestId:(incoming||outgoing).requestId}:{})});return;
      }
      if(view==='detail'){
        const mode=detailMode,delay=detailDelay,friend=overview.friends.find(item=>item.user.userId===url.searchParams.get('userId'));
        if(delay)await new Promise(resolve=>setTimeout(resolve,delay));
        if(mode==='expired'){await reply({error:'登录已过期，请重新登录。',code:'unauthorized'},401);return;}
        if(mode==='forbidden'||!friend){await reply({error:'对方已不是你的好友，无法查看资料。',code:'not_friends'},403);return;}
        await reply({user:friend.user,since:friend.since,stats:hiddenStats?null:{passages:12,encountered:156,practices:43,level:'CET4',updatedAt:now-3600000}});return;
      }
      await reply({error:'Unsupported mock view'},400);return;
    }
    const action=request.postDataJSON();requests.push(action);
    if(action.type==='request'){
      if(requestFailure){requestFailure=false;await reply({error:'发送未完成，请重试。',code:'test_failure'},503);return;}
      overview.outgoing.push({requestId:'outgoing-'+action.userId,user:people.find(person=>person.userId===action.userId),createdAt:now});
    }else if(action.type==='accept'){
      const incoming=overview.incoming.find(item=>item.requestId===action.requestId);
      if(incoming)overview.friends.push({user:incoming.user,since:now});
      overview.incoming=overview.incoming.filter(item=>item.requestId!==action.requestId);
    }else if(action.type==='decline')overview.incoming=overview.incoming.filter(item=>item.requestId!==action.requestId);
    else if(action.type==='cancel')overview.outgoing=overview.outgoing.filter(item=>item.requestId!==action.requestId);
    else if(action.type==='remove')overview.friends=overview.friends.filter(item=>item.user.userId!==action.userId);
    else if(action.type==='profile'){overview.profile=action.profile;overview.published=true;}
    else if(action.type==='invite'){
      if(inviteOperations.has(action.operationId)){await reply({error:'这次邀请码已生成，完整邀请码只显示一次。请查看有效邀请，撤回不需要的邀请后重新生成。',code:'invite_operation_used'},409);return;}
      inviteOperations.add(action.operationId);
      const invite={id:'invite-'+(++inviteSequence),createdAt:now+inviteSequence,expiresAt:now+7*86400000};invites=[invite,...invites];
      if(loseInviteResponse){loseInviteResponse=false;await route.abort('connectionfailed');return;}
      await reply({...invite,code:'WW-'+String(inviteSequence).padStart(64,'a')});return;
    }else if(action.type==='revoke-invite'){invites=invites.filter(item=>item.id!==action.inviteId);await reply({invites});return;}
    else {await reply({error:'Unsupported mock action'},400);return;}
    await reply(overview);
  };
  const settle=()=>page.waitForTimeout(400);
  const section=name=>page.getByRole('tab',{name,exact:true}).click();
  const dialog=()=>page.getByRole('dialog',{name:'好友资料',exact:true});
  const openFriend=async name=>{await page.getByRole('button',{name:'查看好友 '+name,exact:true}).click();await dialog().waitFor();};
  const closeDetail=async()=>{await dialog().getByRole('button',{name:'关闭详情',exact:true}).click();await dialog().waitFor({state:'detached'});};
  const refresh=async()=>{await page.getByRole('button',{name:'刷新好友',exact:true}).click();await settle();};
  page.on('pageerror',onError);
  await page.route('**/api/mobile/**',fixtureRoute);
  try{
    const localAvatar=await page.evaluate(({stateKey,tokenKey})=>{
      const stored=JSON.parse(localStorage.getItem(stateKey)),envelope=JSON.parse(stored.stateJson);
      if(envelope.user.userId!=='preview')throw Error('Not an isolated preview account.');
      const canvas=document.createElement('canvas');canvas.width=64;canvas.height=64;const context=canvas.getContext('2d');context.fillStyle='#6b9075';context.fillRect(0,0,64,64);const avatarDataUrl=canvas.toDataURL('image/jpeg',.7);
      envelope.localProfile={userId:'preview',nickname:'本机昵称',signature:'只在本机的签名',avatar:'custom',avatarDataUrl};stored.stateJson=JSON.stringify(envelope);localStorage.setItem(stateKey,JSON.stringify(stored));sessionStorage.setItem(tokenKey,'friends-ui-isolated-token');return avatarDataUrl;
    },{stateKey,tokenKey});
    await page.setViewportSize({width:393,height:852});await page.emulateMedia({reducedMotion:'no-preference'});await page.reload();
    await page.getByRole('navigation',{name:'主导航'}).getByRole('button',{name:'我的',exact:true}).click();await settle();
    await page.getByRole('button',{name:'我的好友',exact:true}).click();await settle();
    await page.getByRole('button',{name:'查看好友 青禾',exact:true}).waitFor();
    check('friends entry loads the genuine protocol overview without publishing local profile',await page.locator('.app-view[data-active]').getAttribute('data-page')==='my-friends'&&requests.length===0);
    await page.screenshot({path:'output/playwright/friends-home-393.png'});

    await openFriend('青禾');await dialog().getByText('156',{exact:true}).waitFor();
    check('authorized detail shows shared identity and latest synced totals',await dialog().getByText('青禾',{exact:true}).isVisible()&&await dialog().getByText('156',{exact:true}).isVisible()&&await dialog().getByText(/最近同步记录/).isVisible());
    await page.screenshot({path:'output/playwright/friends-detail-393.png'});await closeDetail();
    hiddenStats=true;await openFriend('青禾');await dialog().getByText('对方暂未开放学习汇总。',{exact:true}).waitFor();
    check('private learning totals remain absent',await dialog().getByText('156',{exact:true}).count()===0);await closeDetail();hiddenStats=false;
    detailDelay=650;await openFriend('青禾');await closeDetail();await page.waitForTimeout(700);
    check('late detail response cannot revive a closed sheet',await dialog().count()===0&&await page.evaluate(()=>document.body.style.overflow!=='hidden'));detailDelay=0;
    detailMode='forbidden';await openFriend('青禾');await dialog().getByText('对方已不是你的好友，无法查看资料。',{exact:true}).waitFor();
    check('403 does not fall back to cached identity or learning totals',await dialog().getByText('青禾',{exact:true}).count()===0&&await dialog().getByText('156',{exact:true}).count()===0);await closeDetail();detailMode='open';await refresh();

    await section('添加');
    const searchBox=page.getByRole('textbox',{name:'好友用户名',exact:true});
    await searchBox.fill('slow-reader');await page.getByRole('button',{name:'查找',exact:true}).click();
    await searchBox.fill('new-reader');await page.getByRole('button',{name:'查找',exact:true}).click();await page.getByText('新芽同学',{exact:true}).waitFor();await page.waitForTimeout(450);
    check('new search wins over a slower earlier response',await page.getByText('新芽同学',{exact:true}).isVisible()&&await page.getByText('较慢的搜索结果',{exact:true}).count()===0);
    requestFailure=true;await page.getByRole('button',{name:'发送好友申请',exact:true}).click();await page.getByText('发送未完成，请重试。',{exact:true}).first().waitFor();
    check('failed request leaves retry available and does not claim success',await page.getByRole('button',{name:'发送好友申请',exact:true}).isEnabled()&&await page.getByText('好友申请已发送。',{exact:true}).count()===0&&overview.outgoing.length===1);
    await page.getByRole('button',{name:'发送好友申请',exact:true}).click();await page.getByText('好友申请已发送。',{exact:true}).waitFor();
    check('successful request becomes pending after server confirmation',await page.getByText('已发送申请，等待回应',{exact:true}).isVisible()&&overview.outgoing.length===2);
    await section('申请');
    await page.locator('.friends-request').filter({hasText:'新芽同学'}).getByRole('button',{name:'撤回申请',exact:true}).click();await page.getByText('好友申请已撤回。',{exact:true}).waitFor();
    check('outgoing request can be withdrawn',await page.locator('.friends-request').filter({hasText:'新芽同学'}).count()===0&&overview.outgoing.length===1);
    await page.locator('.friends-request').filter({hasText:'云朵'}).getByRole('button',{name:'拒绝',exact:true}).click();await page.getByText('已拒绝这条好友申请。',{exact:true}).waitFor();
    check('incoming request can be declined',await page.locator('.friends-request').filter({hasText:'云朵'}).count()===0);
    await page.locator('.friends-request').filter({hasText:'雨禾'}).getByRole('button',{name:'接受',exact:true}).click();await page.getByText('已添加好友，可以查看对方公开的资料。',{exact:true}).waitFor();
    await section('好友');check('accepting moves the request into friends',await page.getByRole('button',{name:'查看好友 雨禾',exact:true}).isVisible()&&overview.incoming.length===0);
    await openFriend('雨禾');await dialog().getByRole('button',{name:'移除好友',exact:true}).click();await dialog().getByRole('button',{name:'保留好友',exact:true}).click();
    check('removing a friend requires explicit confirmation',overview.friends.length===2&&await dialog().getByRole('button',{name:'移除好友',exact:true}).isVisible());
    await dialog().getByRole('button',{name:'移除好友',exact:true}).click();await dialog().getByRole('button',{name:'确认移除',exact:true}).click();await dialog().waitFor({state:'detached'});
    check('confirmed removal updates the list after success',await page.getByRole('button',{name:'查看好友 雨禾',exact:true}).count()===0&&overview.friends.length===1);

    await section('我的展示');
    check('learning sharing is off by default and local custom avatar is only a draft',!await page.getByRole('checkbox',{name:/向好友开放学习汇总/}).isChecked()&&await page.locator('.friends-profile-preview img').getAttribute('src')===localAvatar&&requests.filter(action=>action.type==='profile').length===0);
    await page.getByRole('textbox',{name:'展示昵称',exact:true}).fill('准备发布的新昵称');overview.profile={...overview.profile,nickname:'服务器旧昵称'};await refresh();
    check('background overview refresh does not replace an unfinished profile draft',await page.getByRole('textbox',{name:'展示昵称',exact:true}).inputValue()==='准备发布的新昵称');
    await page.getByRole('checkbox',{name:/向好友开放学习汇总/}).check();await page.getByRole('button',{name:'发布展示资料',exact:true}).click();await page.getByText('展示资料已保存，好友可以查看你的学习汇总。',{exact:true}).waitFor();
    const localUnchanged=await page.evaluate(key=>JSON.parse(JSON.parse(localStorage.getItem(key)).stateJson).localProfile.nickname==='本机昵称',stateKey);
    check('explicit profile publication preserves custom avatar and does not overwrite local profile',overview.profile.nickname==='准备发布的新昵称'&&overview.profile.avatar==='custom'&&overview.profile.avatarDataUrl===localAvatar&&overview.profile.shareLearning&&localUnchanged);
    await page.getByRole('checkbox',{name:/向好友开放学习汇总/}).uncheck();await page.getByRole('button',{name:'保存展示设置',exact:true}).click();await page.getByText('展示资料已保存，学习汇总保持隐藏。',{exact:true}).waitFor();
    check('sharing can be turned off again',overview.profile.shareLearning===false);

    await section('好友');listFailure=true;await refresh();
    check('offline list retains cached friends with an explicit cache label',await page.getByText(/正在显示已缓存的列表/).isVisible()&&await page.getByRole('button',{name:'查看好友 青禾',exact:true}).isVisible());listFailure=false;await refresh();
    await section('添加');await page.getByRole('button',{name:'生成一次性邀请码',exact:true}).click();await page.getByRole('textbox',{name:'新邀请码',exact:true}).waitFor();
    check('new invite is selectable with copy and registration entry points',await page.getByRole('textbox',{name:'新邀请码',exact:true}).inputValue()==='WW-'+String(1).padStart(64,'a')&&await page.getByRole('button',{name:'复制邀请码',exact:true}).isVisible()&&await page.getByRole('link',{name:/打开词间网站/}).getAttribute('href')==='https://wordweave-cet-study.shiw36663.chatgpt.site');
    await page.locator('.friends-invites').getByRole('button',{name:'撤回',exact:true}).click();await page.getByText('邀请码已撤回。',{exact:true}).waitFor();
    check('revoking clears the active invite and its displayed code',invites.length===0&&await page.getByRole('textbox',{name:'新邀请码',exact:true}).count()===0);
    loseInviteResponse=true;await page.getByRole('button',{name:'生成一次性邀请码',exact:true}).click();await page.waitForTimeout(450);
    const lostOperation=requests.filter(action=>action.type==='invite').at(-1).operationId;
    await page.getByRole('button',{name:'生成一次性邀请码',exact:true}).click();await page.getByRole('button',{name:'生成新的邀请码',exact:true}).waitFor();
    const retryOperation=requests.filter(action=>action.type==='invite').at(-1).operationId;
    check('ambiguous invite retry reuses its operation id and exposes a new-request option after 409',lostOperation===retryOperation&&inviteSequence===2&&await page.locator('.friends-invites li').count()===1);
    await page.getByRole('button',{name:'生成新的邀请码',exact:true}).click();await page.getByRole('textbox',{name:'新邀请码',exact:true}).waitFor();
    check('explicit new invite recovers from a used operation receipt',requests.filter(action=>action.type==='invite').at(-1).operationId!==lostOperation&&inviteSequence===3);

    await page.setViewportSize({width:320,height:640});await page.evaluate(()=>{document.documentElement.classList.add('dark');document.documentElement.style.fontSize='125%';});
    await section('我的展示');await settle();
    check('profile form fits 320 px dark mode at 125 percent type',await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:'output/playwright/friends-profile-dark-320.png',fullPage:true});
    await section('添加');await settle();check('search and invite controls fit 320 px with large type',await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    await section('好友');await openFriend('青禾');await dialog().getByText('156',{exact:true}).waitFor();await settle();
    check('friend sheet fits a narrow viewport and large type',await page.evaluate(()=>{const node=document.querySelector('[role="dialog"][aria-label="好友资料"]'),box=node.getBoundingClientRect();return box.left>=-1&&box.right<=innerWidth+1&&node.scrollWidth<=node.clientWidth+1;}));await closeDetail();
    detailMode='expired';await openFriend('青禾');await page.getByRole('button',{name:'前往登录',exact:true}).waitFor();await settle();
    check('401 clears private friend content including the closing sheet',await dialog().count()===0&&await page.locator('.friends-page').getByText('青禾',{exact:true}).count()===0&&await page.locator('.friends-page').getByText('156',{exact:true}).count()===0);
    await page.getByRole('button',{name:'前往登录',exact:true}).click();await page.getByRole('textbox',{name:'词间用户名',exact:true}).waitFor();
    check('expired session offers login without losing local learning state',await page.evaluate(key=>{const envelope=JSON.parse(JSON.parse(localStorage.getItem(key)).stateJson);return envelope.user.userId==='preview'&&!!envelope.state;},stateKey));
    check('friend interactions raise no uncaught page errors',errors.length===0,errors);
  }catch(error){check('friends interaction sequence completes',false,error.message);}
  finally{
    await page.evaluate(({stateKey,tokenKey,original})=>{
      const current=JSON.parse(localStorage.getItem(stateKey));
      if(JSON.parse(current.stateJson).user?.userId!=='preview')throw Error('Refusing to restore friends fixture over a real account.');
      localStorage.setItem(stateKey,original.raw);
      if(original.token===null)sessionStorage.removeItem(tokenKey);else sessionStorage.setItem(tokenKey,original.token);
      if(original.theme===null)localStorage.removeItem('wordweave-mobile-theme');else localStorage.setItem('wordweave-mobile-theme',original.theme);
      document.documentElement.style.fontSize=original.font;document.documentElement.classList.toggle('dark',original.dark);
    },{stateKey,tokenKey,original});
    if(viewport)await page.setViewportSize(viewport);await page.emulateMedia({reducedMotion:'no-preference'});await page.reload();
    await page.unroute('**/api/mobile/**',fixtureRoute);page.off('pageerror',onError);
  }
  return JSON.stringify({pass:checks.every(item=>item.pass),checks});
}
