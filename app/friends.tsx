'use client';
/* eslint-disable @next/next/no-img-element -- Profile photos are validated, bounded JPEG data URLs, not remote image assets. */

import { useCallback, useEffect, useId, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { BookOpen, Check, ChevronLeft, ChevronRight, Coffee, Copy, Leaf, Link, Mountain, RefreshCw, Search, ShieldCheck, Sun, UserPlus, Users } from 'lucide-react';
import type { CreatedFriendInvite, FriendAction, FriendDetail, FriendIdentity, FriendInvite, FriendSearch, SharedProfile } from '@/lib/friends-protocol';
import { sharedProfileSchema } from '@/lib/friends-protocol';
import { WebFriendsService, WebFriendsError } from '@/lib/web-friends';
import { createPortal } from 'react-dom';
type PersonalProfile = Omit<SharedProfile, 'shareLearning'>;
import './friends.css';


const fallbackProfile: PersonalProfile = { nickname: '', signature: '', avatar: 'initial' };
export type FriendsProps = { username: string; profile?: PersonalProfile; onBack: () => void; onSessionExpired: () => void };

export function Friends({ username, profile = fallbackProfile, onBack, onSessionExpired }: FriendsProps) {
  const [service, setService] = useState<WebFriendsService | null>(null);
  const expired = useRef(onSessionExpired);
  useEffect(() => { expired.current = onSessionExpired; }, [onSessionExpired]);
  useEffect(() => {
    const next = new WebFriendsService(username);
    let notified = false;
    const unsubscribe = next.subscribe(() => {
      if (next.snapshot.unauthorized && !notified) { notified = true; expired.current(); }
    });
    // Create/dispose the account transport in the committed lifecycle, including Strict Mode remounts.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setService(next);
    return () => { unsubscribe(); next.dispose(); };
  }, [username]);
  if (!service || service.username !== username) return <p className="wf-loading" role="status">正在打开好友中心…</p>;
  return <FriendsPage key={username} userId={username} localProfile={profile} service={service} onBack={onBack} onLogin={onSessionExpired} />;
}

function Presence({ show, children }: { show: boolean; portal?: boolean; children: ReactNode }) { return show ? children : null; }
function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const close = useRef(onClose);
  useEffect(() => { close.current = onClose; }, [onClose]);
  useEffect(() => {
    const element = dialog.current;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    element?.showModal();
    return () => { element?.close(); document.body.style.overflow = overflow; if (previous?.isConnected) previous.focus({ preventScroll: true }); };
  }, []);
  return createPortal(<dialog ref={dialog} className="wf-dialog" aria-labelledby={titleId} onCancel={event => { event.preventDefault(); close.current(); }} onClick={event => { if (event.target === event.currentTarget) { const rect = event.currentTarget.getBoundingClientRect(); if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) close.current(); } }}><header className="wf-dialog-header"><h2 id={titleId}>{title}</h2><button type="button" className="icon-button" aria-label="关闭好友资料" onClick={() => close.current()}>×</button></header>{children}</dialog>, document.body);
}

type Section = 'friends' | 'requests' | 'add' | 'profile';
const tabs: { id: Section; label: string }[] = [{id:'friends',label:'好友'}, {id:'requests',label:'申请'}, {id:'add',label:'添加'}, {id:'profile',label:'我的展示'}];
const avatars = [{id:'initial',label:'首字',Icon:null}, {id:'book',label:'书页',Icon:BookOpen}, {id:'sprout',label:'新芽',Icon:Leaf}, {id:'sun',label:'晨光',Icon:Sun}, {id:'mountain',label:'远山',Icon:Mountain}, {id:'coffee',label:'咖啡',Icon:Coffee}] as const;
const displayName = (user: FriendIdentity) => user.nickname || user.username;
function dateLabel(value: number) { return value ? new Date(value).toLocaleString('zh-CN', {timeZone:'Asia/Shanghai',month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit',hour12:false}) : '尚无同步记录'; }
function errorLabel(error: unknown) { return error instanceof Error ? error.message : '暂时无法完成，请稍后重试。'; }
function sharedLocal(profile: PersonalProfile): SharedProfile { return {...profile,shareLearning:false}; }

function Avatar({profile, name}: {profile: Pick<SharedProfile,'avatar'|'avatarDataUrl'>; name:string}) {
  const Icon = avatars.find(item=>item.id===profile.avatar)?.Icon;
  return <span className="wf-avatar" aria-hidden="true">{profile.avatar==='custom' && profile.avatarDataUrl ? <img src={profile.avatarDataUrl} alt=""/> : Icon ? <Icon size={23} strokeWidth={1.5}/> : [...name][0] || '我'}</span>;
}
function Identity({user, children}: {user:FriendIdentity;children?:ReactNode}) {
  return <div className="wf-identity"><Avatar profile={user} name={displayName(user)}/><div className="wf-identity-copy"><strong>{displayName(user)}</strong><small>@{user.username}</small>{children}</div></div>;
}
function Empty({icon, title, children}: {icon:ReactNode;title:string;children:ReactNode}) {
  return <div className="wf-empty"><span aria-hidden="true">{icon}</span><h2>{title}</h2><p>{children}</p></div>;
}

function FriendsPage({userId, localProfile, service, onBack, onLogin}: {
  userId:string;localProfile:PersonalProfile;service:WebFriendsService;onBack:()=>void;onLogin:()=>void;
}) {
  const snapshot = useSyncExternalStore(useCallback(fn=>service.subscribe(fn),[service]),useCallback(()=>service.snapshot,[service]));
  const {overview,loading,mutating,error,unauthorized,updatedAt} = snapshot;
  const [section,setSection] = useState<Section>('friends');
  const [notice,setNotice] = useState('');
  const [actionError,setActionError] = useState('');
  const [pending,setPending] = useState('');
  const pendingRef = useRef(false);
  const scope = useRef(0);
  const [query,setQuery] = useState('');
  const [result,setResult] = useState<FriendSearch|null>(null);
  const [searched,setSearched] = useState(false);
  const [searching,setSearching] = useState(false);
  const [searchError,setSearchError] = useState('');
  const searchSerial = useRef(0);
  const [detailUser,setDetailUser] = useState<FriendIdentity|null>(null);
  const [detail,setDetail] = useState<FriendDetail|null>(null);
  const [detailLoading,setDetailLoading] = useState(false);
  const [detailError,setDetailError] = useState('');
  const [confirmRemove,setConfirmRemove] = useState(false);
  const detailSerial = useRef(0);
  const [draft,setDraft] = useState<SharedProfile>(()=>sharedLocal(localProfile));
  const profileInitialized = useRef(false);
  const [inviteList,setInviteList] = useState<FriendInvite[]>([]);
  const [inviteLoaded,setInviteLoaded] = useState(false);
  const [inviteLoading,setInviteLoading] = useState(false);
  const [inviteError,setInviteError] = useState('');
  const [createdInvite,setCreatedInvite] = useState<CreatedFriendInvite|null>(null);
  const [inviteReissue,setInviteReissue] = useState(false);
  const inviteOperation = useRef('');
  const inviteSerial = useRef(0);
  const id = useId();
  const busy = mutating || !!pending || loading;
  const [now,setNow] = useState(Date.now);
  const local = useRef(localProfile);
  useEffect(()=>{local.current=localProfile;},[localProfile]);
  useEffect(()=>{
    const tick=()=>setNow(Date.now());
    const timer=window.setInterval(tick,30_000);
    window.addEventListener('focus',tick);
    return ()=>{window.clearInterval(timer);window.removeEventListener('focus',tick);};
  },[]);

  useEffect(()=>{
    scope.current++;
    const lifetime=scope,searchToken=searchSerial,detailToken=detailSerial,inviteToken=inviteSerial;
    let previous=service.snapshot.overview;
    const unsubscribe=service.subscribe(()=>{
      const current=service.snapshot;
      if(current.unauthorized){
        lifetime.current++;detailToken.current++;searchToken.current++;inviteToken.current++;
        setDetailUser(null);setDetail(null);setResult(null);setCreatedInvite(null);setInviteList([]);
        setDraft(sharedLocal(fallbackProfile));setQuery('');setNotice('');setActionError('');
        return;
      }
      if(previous!==current.overview){
        previous=current.overview;
        // Remote removal or revoked sharing also closes an already open detail.
        detailToken.current++;
        setDetailUser(null);setDetail(null);setDetailLoading(false);setDetailError('');setConfirmRemove(false);
      }
      if(current.overview&&!profileInitialized.current){
        profileInitialized.current=true;
        setDraft(current.overview.published?{...current.overview.profile}:sharedLocal(local.current));
      }
    });
    void service.load().catch(()=>{});
    return ()=>{unsubscribe();lifetime.current++;searchToken.current++;detailToken.current++;inviteToken.current++;};
  },[service,userId]);

  const readInvites = useCallback(async()=>{
    const token=++inviteSerial.current, current=scope.current;
    setInviteLoading(true);setInviteError('');
    try {const value=await service.invites();if(token===inviteSerial.current&&current===scope.current){setInviteList(value.invites);setCreatedInvite(previous=>previous&&value.invites.some(item=>item.id===previous.id)?previous:null);setInviteLoaded(true);}}
    catch(cause){if(token===inviteSerial.current&&current===scope.current)setInviteError(errorLabel(cause));}
    finally{if(token===inviteSerial.current&&current===scope.current)setInviteLoading(false);}
  },[service]);
  useEffect(()=>{
    if(section!=='add'||!overview||loading||unauthorized||inviteLoaded||inviteLoading||inviteError)return;
    // Defer optional tab data so leaving the tab before the next task cancels the request.
    const timer=window.setTimeout(()=>void readInvites(),0);
    return ()=>window.clearTimeout(timer);
  },[section,overview,loading,unauthorized,inviteLoaded,inviteLoading,inviteError,readInvites]);

  async function refresh() {
    if(busy||unauthorized)return;
    const current=scope.current;
    detailSerial.current++;searchSerial.current++;
    setDetailUser(null);setDetail(null);setResult(null);setSearched(false);setSearching(false);setActionError('');
    await service.load(true);
    if(current===scope.current&&!service.snapshot.unauthorized&&section==='add')await readInvites();
  }

  async function act(action: FriendAction, key: string, success: string): Promise<unknown> {
    if(pendingRef.current||mutating||loading||unauthorized)return undefined;
    const current=scope.current;
    pendingRef.current=true;setPending(key);setActionError('');setNotice('');
    try {
      const value=await service.mutate(action);
      if(current===scope.current){
        setNotice(success);
        if(['accept','decline','cancel','remove'].includes(action.type)){searchSerial.current++;setResult(null);setSearched(false);setSearching(false);}
      }
      return value;
    } catch(cause) {
      if(current===scope.current)setActionError(errorLabel(cause));
      throw cause;
    } finally {
      pendingRef.current=false;
      if(current===scope.current)setPending('');
    }
  }
  async function perform(action:FriendAction,key:string,success:string) {try{await act(action,key,success);}catch{/* The error is shown beside the action. */}}
  async function search() {
    const username=query.trim();if(!username||busy||unauthorized)return;
    const token=++searchSerial.current,current=scope.current;
    setSearching(true);setSearched(false);setResult(null);setSearchError('');setNotice('');
    try{const value=await service.search(username);if(token===searchSerial.current&&current===scope.current){setResult(value);setSearched(true);}}
    catch(cause){if(token===searchSerial.current&&current===scope.current)setSearchError(errorLabel(cause));}
    finally{if(token===searchSerial.current&&current===scope.current)setSearching(false);}
  }
  async function requestFriend(user:FriendIdentity) {
    const token=searchSerial.current,current=scope.current;
    try{const saved=await act({type:'request',userId:user.userId},`request-${user.userId}`,'好友申请已发送。');if(saved!==undefined&&token===searchSerial.current&&current===scope.current)setResult(old=>old?.user?.userId===user.userId?{...old,relationship:'outgoing'}:old);}catch{/* Keep the search result for retry. */}
  }
  async function openDetail(user:FriendIdentity) {
    if(busy||unauthorized)return;
    const token=++detailSerial.current,current=scope.current;
    setDetailUser(user);setDetail(null);setConfirmRemove(false);setDetailError('');setDetailLoading(true);setActionError('');
    try{const value=await service.detail(user.userId);if(token===detailSerial.current&&current===scope.current)setDetail(value);}
    catch(cause){if(token===detailSerial.current&&current===scope.current)setDetailError(errorLabel(cause));}
    finally{if(token===detailSerial.current&&current===scope.current)setDetailLoading(false);}
  }
  function closeDetail(){if(pendingRef.current)return;detailSerial.current++;setDetailUser(null);setConfirmRemove(false);setActionError('');}
  async function removeFriend(){
    if(!detailUser)return;const current=scope.current;
    try{const saved=await act({type:'remove',userId:detailUser.userId},'remove','已移除好友。');if(saved!==undefined&&current===scope.current){detailSerial.current++;setDetailUser(null);setConfirmRemove(false);}}catch{/* The confirmation remains available for retry. */}
  }
  async function publish(){
    const checked=sharedProfileSchema.safeParse({...draft,avatarDataUrl:draft.avatar==='custom'?draft.avatarDataUrl:undefined});
    if(!checked.success){setActionError('请检查昵称、签名和头像后重试。');return;}
    const current=scope.current;
    try{
      const saved=await act({type:'profile',profile:checked.data},'profile',checked.data.shareLearning?'展示资料已保存，好友可以查看你的学习汇总。':'展示资料已保存，学习汇总保持隐藏。');
      if(saved!==undefined&&current===scope.current)setDraft(checked.data);
    }catch{/* Keep the editable draft when publication fails. */}
  }
  async function createInvite(){
    if(!inviteOperation.current)inviteOperation.current=crypto.randomUUID();
    const current=scope.current;
    try{
      const value=await act({type:'invite',operationId:inviteOperation.current},'invite','邀请码已生成，可复制给想邀请的人。') as CreatedFriendInvite|undefined;
      if(value&&current===scope.current){setCreatedInvite(value);setInviteReissue(false);inviteOperation.current='';setInviteList(old=>[value,...old.filter(item=>item.id!==value.id)]);setInviteLoaded(true);void readInvites();}
    }catch(cause){
      // A network failure retains the operation id. An explicit used receipt
      // proves that retrying cannot recover the one-time plaintext code.
      if(current===scope.current&&cause instanceof WebFriendsError&&cause.code==='invite_operation_used'){
        inviteOperation.current='';setInviteReissue(true);void readInvites();
      }
    }
  }
  async function revokeInvite(inviteId:string){
    const current=scope.current;
    try{const value=await act({type:'revoke-invite',inviteId},`revoke-${inviteId}`,'邀请码已撤回。');if(value!==undefined&&current===scope.current){inviteOperation.current='';setInviteList(old=>old.filter(item=>item.id!==inviteId));setCreatedInvite(old=>old?.id===inviteId?null:old);}}catch{/* Leave the valid code visible until the server confirms revocation. */}
  }
  async function copyCode(){
    if(!createdInvite)return;
    const current=scope.current;
    try{await navigator.clipboard.writeText(createdInvite.code);if(current===scope.current)setNotice('邀请码已复制。');}
    catch{if(current===scope.current)setActionError('暂时无法复制，请选中邀请码文字手动复制。');}
  }
  const savedProfile=overview?.profile;
  const profileDirty=!overview?.published||!savedProfile||draft.nickname!==savedProfile.nickname||draft.signature!==savedProfile.signature||draft.avatar!==savedProfile.avatar||draft.avatarDataUrl!==savedProfile.avatarDataUrl||draft.shareLearning!==savedProfile.shareLearning;
  const incoming=overview?.incoming??[],outgoing=overview?.outgoing??[],friends=overview?.friends??[];
  const activeInvites=inviteList.filter(invite=>invite.expiresAt>now);
  const found=result?.user;
  const relationship=found?.username.toLowerCase()===userId.toLowerCase()?'self':found&&friends.some(friend=>friend.user.userId===found.userId)?'friend':found&&incoming.some(request=>request.user.userId===found.userId)?'incoming':found&&outgoing.some(request=>request.user.userId===found.userId)?'outgoing':result?.relationship;

  return <div className="wf-page">
    <header className="wf-heading"><button type="button" className="icon-button" aria-label="返回个人主页" onClick={onBack} disabled={busy}><ChevronLeft size={22}/></button><div><span className="eyebrow">LEARNING, TOGETHER</span><h1 tabIndex={-1}>好友</h1><p>看见彼此的积累，保持自己的节奏。</p></div><button type="button" className="wf-refresh" aria-label="刷新好友" disabled={loading||busy} onClick={()=>void refresh()}><RefreshCw size={18}/><span>{loading?'更新中':'刷新'}</span></button></header>
    {unauthorized ? <section className="wf-card"><Empty icon={<ShieldCheck size={28}/>} title="登录后，与好友相遇">好友资料需要在线验证身份。请登录后再试，本机学习记录不会因此丢失。</Empty><button type="button" className="primary wf-full" onClick={onLogin}>前往登录</button></section> : <>
      <div className="wf-tabs" role="tablist" aria-label="好友中心">{tabs.map((tab,index)=><button type="button" role="tab" id={`${id}-${tab.id}`} aria-label={tab.label} aria-description={tab.id==='requests'&&incoming.length>0?`${incoming.length} 个待处理申请`:undefined} aria-controls={`${id}-panel`} aria-selected={section===tab.id} tabIndex={section===tab.id?0:-1} key={tab.id} onClick={()=>{setSection(tab.id);setActionError('');setNotice('');}} onKeyDown={event=>{const next=event.key==='Home'?0:event.key==='End'?tabs.length-1:event.key==='ArrowRight'?(index+1)%tabs.length:event.key==='ArrowLeft'?(index+tabs.length-1)%tabs.length:-1;if(next<0)return;event.preventDefault();setSection(tabs[next].id);document.getElementById(`${id}-${tabs[next].id}`)?.focus();}}>{tab.label}{tab.id==='requests'&&incoming.length>0&&<span className="wf-count" aria-hidden="true">{incoming.length}</span>}</button>)}</div>
      {error&&<div className="wf-status wf-status-error" role="alert"><p>{error}</p>{overview&&<small>正在显示已缓存的列表 · 更新于 {dateLabel(updatedAt)}。好友资料需联网后重新确认。</small>}<button type="button" disabled={loading||busy} onClick={()=>void refresh()}>重新加载</button></div>}
      {notice&&<p className="wf-notice" role="status"><Check size={16}/>{notice}</p>}
      {actionError&&!detailUser&&<p className="wf-error" role="alert">{actionError}</p>}
      <div id={`${id}-panel`} role="tabpanel" aria-labelledby={`${id}-${section}`} className="wf-panel">
        {section==='friends'&&<section className="wf-card"><div className="wf-section-title"><h2>我的好友</h2><span>{friends.length} 位</span></div>
          {!overview&&loading?<p className="wf-loading" role="status">正在加载好友…</p>:!overview&&error?<p className="wf-note">列表暂时不可用，重新加载后即可查看。</p>:!friends.length?<><Empty icon={<Users size={30}/>} title="一起学习，从一位好友开始">添加认识的人，就能在这里看到对方愿意分享的资料。</Empty><button type="button" className="secondary wf-full" onClick={()=>setSection('add')}><UserPlus size={17}/>添加好友</button></>:<ul className="wf-list">{friends.map(friend=><li key={friend.user.userId}><button type="button" className="wf-person-button" disabled={busy} onClick={()=>void openDetail(friend.user)} aria-label={`查看好友 ${displayName(friend.user)}`}><Identity user={friend.user}><p>{friend.user.signature||'还没有填写签名'}</p></Identity><ChevronRight size={18}/></button></li>)}</ul>}
          {!!friends.length&&<p className="wf-note">资料与学习汇总由好友自主开放，以最近同步记录为准。</p>}
        </section>}
        {section==='requests'&&<>
          <section className="wf-card"><div className="wf-section-title"><h2>收到的申请</h2><span>{incoming.length} 条</span></div>{!overview&&loading?<p className="wf-loading" role="status">正在加载申请…</p>:!overview&&error?<p className="wf-note">申请暂时不可用，请重新加载。</p>:incoming.length?<ul className="wf-list">{incoming.map(request=><li className="wf-request" key={request.requestId}><Identity user={request.user}><p>{dateLabel(request.createdAt)} 发来申请</p></Identity><div className="wf-row-actions"><button type="button" className="secondary" disabled={busy} onClick={()=>void perform({type:'decline',requestId:request.requestId},`decline-${request.requestId}`,'已拒绝这条好友申请。')}>{pending===`decline-${request.requestId}`?'处理中…':'拒绝'}</button><button type="button" className="primary" disabled={busy} onClick={()=>void perform({type:'accept',requestId:request.requestId},`accept-${request.requestId}`,'已添加好友，可以查看对方公开的资料。')}>{pending===`accept-${request.requestId}`?'添加中…':'接受'}</button></div></li>)}</ul>:<p className="wf-quiet">暂时没有新的好友申请。</p>}</section>
          <section className="wf-card"><div className="wf-section-title"><h2>发出的申请</h2><span>{outgoing.length} 条</span></div>{outgoing.length?<ul className="wf-list">{outgoing.map(request=><li className="wf-request" key={request.requestId}><Identity user={request.user}><p>等待对方接受 · {dateLabel(request.createdAt)}</p></Identity><div className="wf-row-actions"><button type="button" className="secondary" disabled={busy} onClick={()=>void perform({type:'cancel',requestId:request.requestId},`cancel-${request.requestId}`,'好友申请已撤回。')}>{pending===`cancel-${request.requestId}`?'撤回中…':'撤回申请'}</button></div></li>)}</ul>:<p className="wf-quiet">没有等待回应的申请。</p>}</section>
        </>}
        {section==='add'&&<>
          <section className="wf-card"><div className="wf-section-title"><h2>按用户名添加</h2><Search size={18}/></div><p className="wf-note">输入对方完整的登录用户名，昵称不用于搜索。</p><form className="wf-search" onSubmit={event=>{event.preventDefault();void search();}}><label className="wf-sr-only" htmlFor={`${id}-search`}>好友用户名</label><input id={`${id}-search`} value={query} maxLength={32} autoComplete="off" autoCapitalize="none" spellCheck={false} placeholder="输入完整用户名" onChange={event=>{searchSerial.current++;setQuery(event.target.value);setResult(null);setSearched(false);setSearching(false);setSearchError('');}}/><button type="submit" className="primary" disabled={busy||!query.trim()||searching}>{searching?'查找中…':'查找'}</button></form>
            {searchError&&<p className="wf-error" role="alert">{searchError}</p>}{searched&&!found&&<p className="wf-quiet" role="status">没有找到这个用户名，请确认拼写。</p>}{found&&<div className="wf-search-result"><Identity user={found}><p>{found.signature||'还没有填写签名'}</p></Identity><div className="wf-row-actions">{relationship==='none'?<button type="button" className="primary" disabled={busy} onClick={()=>void requestFriend(found)}>{pending===`request-${found.userId}`?'发送中…':'发送好友申请'}</button>:relationship==='friend'?<button type="button" className="secondary" disabled={busy} onClick={()=>void openDetail(found)}>查看好友资料</button>:relationship==='incoming'?<button type="button" className="secondary" onClick={()=>setSection('requests')}>去处理好友申请</button>:<span className="wf-tag">{relationship==='self'?'这是你自己的账号':'已发送申请，等待回应'}</span>}</div></div>}
          </section>
          <section className="wf-card"><div className="wf-section-title"><h2>邀请新朋友</h2><Link size={18}/></div><p className="wf-note">生成一次性邀请码，交给还没有账号的朋友。对方在词间网站注册后，再用用户名添加好友。</p><button type="button" className="secondary wf-full" disabled={busy} onClick={()=>void createInvite()}>{pending==='invite'?'正在生成…':inviteReissue?'生成新的邀请码':'生成一次性邀请码'}</button>
            {createdInvite&&createdInvite.expiresAt>now&&<div className="wf-invite-created"><label htmlFor={`${id}-invite-code`}>新邀请码 · {dateLabel(createdInvite.expiresAt)} 前有效</label><div><input id={`${id}-invite-code`} aria-label="新邀请码" readOnly value={createdInvite.code} onFocus={event=>event.currentTarget.select()}/><button type="button" className="wf-copy" onClick={()=>void copyCode()} aria-label="复制邀请码"><Copy size={17}/></button></div><p>邀请码仅此处显示，请及时复制。每个邀请码只能使用一次。</p></div>}
            <div className="wf-section-title wf-invite-heading"><h3>有效邀请</h3><button type="button" className="wf-text-button" disabled={inviteLoading||busy} onClick={()=>void readInvites()}>{inviteLoading?'更新中…':'刷新'}</button></div>{inviteError&&<p className="wf-error" role="alert">{inviteError}</p>}{inviteLoading&&!inviteLoaded?<p className="wf-loading" role="status">正在加载邀请…</p>:activeInvites.length?<ul className="wf-invites">{activeInvites.map(invite=><li key={invite.id}><div><strong>{dateLabel(invite.createdAt)} 创建</strong><small>{dateLabel(invite.expiresAt)} 到期</small></div><button type="button" className="wf-text-button" disabled={busy} onClick={()=>void revokeInvite(invite.id)}>{pending===`revoke-${invite.id}`?'撤回中…':'撤回'}</button></li>)}</ul>:inviteLoaded&&!inviteError?<p className="wf-quiet">暂无有效邀请码。</p>:null}
          </section>
        </>}
        {section==='profile'&&<section className="wf-card"><div className="wf-section-title"><h2>我向好友展示的资料</h2><span className="wf-tag">{overview?.published?'已发布':'尚未发布'}</span></div><p className="wf-note">本机个人资料不会自动上传。其他用户仅能通过完整用户名找到你的账号；添加为好友后才能查看已发布的展示资料，学习汇总需另行开启。</p>
          {!overview?<p className="wf-loading" role="status">{loading?'正在读取展示设置…':'请先重新加载好友中心，再修改展示设置。'}</p>:<form className="wf-profile-form" onSubmit={event=>{event.preventDefault();void publish();}}>
            <div className="wf-profile-preview"><Avatar profile={draft} name={draft.nickname||'我'}/><div><strong>{draft.nickname||'使用账号名'}</strong><p>{draft.signature||'还没有填写签名'}</p></div></div>
            <button type="button" className="secondary wf-full" disabled={busy} onClick={()=>{setDraft({...localProfile,shareLearning:draft.shareLearning});setNotice('已填入本机资料，点击保存后才会发布。');setActionError('');}}>填入本机头像、昵称和签名</button>
            <fieldset className="wf-avatar-picker" disabled={busy}><legend>展示头像</legend><div role="radiogroup" aria-label="好友展示头像" onKeyDown={event=>{const available=draft.avatarDataUrl?[...avatars,{id:'custom' as const,label:'照片',Icon:null}]:avatars;const index=available.findIndex(avatar=>avatar.id===draft.avatar);const next=event.key==='Home'?0:event.key==='End'?available.length-1:['ArrowRight','ArrowDown'].includes(event.key)?(index+1)%available.length:['ArrowLeft','ArrowUp'].includes(event.key)?(index+available.length-1)%available.length:-1;if(next<0||busy)return;event.preventDefault();setDraft({...draft,avatar:available[next].id});event.currentTarget.querySelectorAll<HTMLButtonElement>('button')[next]?.focus();}}>{avatars.map(({id:avatarId,label,Icon})=><button key={avatarId} type="button" role="radio" aria-label={label} aria-checked={draft.avatar===avatarId} tabIndex={draft.avatar===avatarId?0:-1} onClick={()=>setDraft({...draft,avatar:avatarId})}><span>{Icon?<Icon size={21}/>: [...(draft.nickname||'我')][0]}</span><small>{label}</small></button>)}{draft.avatarDataUrl&&<button type="button" role="radio" aria-label="照片" aria-checked={draft.avatar==='custom'} tabIndex={draft.avatar==='custom'?0:-1} onClick={()=>setDraft({...draft,avatar:'custom'})}><img src={draft.avatarDataUrl} alt=""/><small>照片</small></button>}</div></fieldset>
            <p className="wf-note">更换照片可先在个人主页编辑头像，再填入这里。</p>
            <label htmlFor={`${id}-nickname`}>展示昵称<span>{draft.nickname.length}/24</span></label><input id={`${id}-nickname`} aria-label="展示昵称" maxLength={24} value={draft.nickname} placeholder="留空使用账号名" disabled={busy} onChange={event=>setDraft({...draft,nickname:event.target.value})}/>
            <label htmlFor={`${id}-signature`}>展示签名<span>{draft.signature.length}/80</span></label><textarea id={`${id}-signature`} aria-label="展示签名" maxLength={80} rows={3} value={draft.signature} placeholder="分享一句此刻的心情" disabled={busy} onChange={event=>setDraft({...draft,signature:event.target.value})}/>
            <label className="wf-share-toggle"><input type="checkbox" checked={draft.shareLearning} disabled={busy} onChange={event=>setDraft({...draft,shareLearning:event.target.checked})}/><span><strong>向好友开放学习汇总</strong><small>已读篇数、接触词数、练习次数和当前词表。默认关闭，不展示具体学习记录。</small></span></label>
            <button type="submit" className="primary wf-full" disabled={busy||!profileDirty}>{pending==='profile'?'正在保存…':overview.published?'保存展示设置':'发布展示资料'}</button>
          </form>}
        </section>}
      </div>
      {updatedAt>0&&!error&&<p className="wf-footer">最近更新于 {dateLabel(updatedAt)} · 点击刷新获取更新</p>}
    </>}
    {!unauthorized&&<Presence show={!!detailUser} portal><Modal title="好友资料" onClose={closeDetail}><div className="wf-detail">
      {unauthorized?null:detailLoading?<p className="wf-loading" role="status">正在确认好友关系并加载资料…</p>:detailError?<><Empty icon={<ShieldCheck size={28}/>} title="暂时无法查看好友资料">{detailError}</Empty><button type="button" className="secondary wf-full" onClick={()=>detailUser&&void openDetail(detailUser)}>重新加载资料</button></>:detail?<>
        <Identity user={detail.user}/><p className="wf-detail-signature">{detail.user.signature||'还没有填写签名'}</p><p className="wf-note">从 {dateLabel(detail.since)} 成为好友</p>
        <section className="wf-detail-stats"><h2>学习的足迹</h2>{detail.stats?<><dl><div><dt>已读篇数</dt><dd>{detail.stats.passages.toLocaleString()}</dd></div><div><dt>接触词数</dt><dd>{detail.stats.encountered.toLocaleString()}</dd></div><div><dt>练习次数</dt><dd>{detail.stats.practices.toLocaleString()}</dd></div></dl><p>当前词表：{detail.stats.level==='CET4'?'四级':'六级'}</p><p className="wf-note">按对方最近同步记录统计 · {dateLabel(detail.stats.updatedAt)}<br/>阅读接触不代表已经掌握。</p></>:<p className="wf-note"><ShieldCheck size={16}/>对方暂未开放学习汇总。</p>}</section>
        {actionError&&<p className="wf-error" role="alert">{actionError}</p>}
        {confirmRemove?<div className="wf-remove-confirm"><h3>移除这位好友？</h3><p>移除后，双方将无法继续查看彼此的好友学习汇总。之后可以重新发送申请。</p><div className="wf-row-actions"><button type="button" className="secondary" disabled={busy} onClick={()=>{setConfirmRemove(false);setActionError('');}}>保留好友</button><button type="button" className="danger" disabled={busy} onClick={()=>void removeFriend()}>{pending==='remove'?'移除中…':'确认移除'}</button></div></div>:<button type="button" className="wf-remove" disabled={busy} onClick={()=>setConfirmRemove(true)}>移除好友</button>}
      </>:null}
    </div></Modal></Presence>}
  </div>;
}
