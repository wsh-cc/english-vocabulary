import { useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { ArrowUpRight, BookOpen, Check, ChevronLeft, ChevronRight, Cloud, Coffee, Database, Info, ImagePlus, Leaf, Mountain, Pencil, Settings2, Sun, Users } from 'lucide-react';
import { readingPassages } from '@/lib/curriculum';
import { seedWords, type State } from '@/lib/learning';
import type { LearningSnapshot } from './data';
import { Modal } from './Study';
import { Presence } from './Motion';
import { profileSchema, type PersonalProfile, type ProfileAvatar } from './profile';
import { prepareAvatar } from './avatar';
import './PersonalPage.css';

export type PersonalSection = 'home' | 'settings' | 'sync' | 'data' | 'about' | 'friends';
const wordIds = new Set(seedWords.map(word => word.id));
const passageIds = new Set(readingPassages.map(passage => passage.id));
export function personalTotals(state: State) {
  return {
    passages: Object.keys(state.reading?.completed ?? {}).filter(id => passageIds.has(id)).length,
    encountered: Object.entries(state.reading?.encounters ?? {}).filter(([id, value]) => wordIds.has(id) && value.count > 0).length,
    practices: state.events.length,
  };
}

const avatars = [
  {id:'initial', label:'首字', Icon:null}, {id:'book', label:'书页', Icon:BookOpen},
  {id:'sprout', label:'新芽', Icon:Leaf}, {id:'sun', label:'晨光', Icon:Sun},
  {id:'mountain', label:'远山', Icon:Mountain}, {id:'coffee', label:'咖啡', Icon:Coffee},
] as const;

function Avatar({kind, name, photo}: {kind: ProfileAvatar; name: string; photo?:string}) {
  const Icon = avatars.find(avatar => avatar.id === kind)?.Icon;
  return <span className="personal-avatar" aria-hidden="true">{kind==='custom'&&photo?<img src={photo} alt=""/>:Icon ? <Icon size={30} strokeWidth={1.5}/> : [...name][0] || '我'}</span>;
}

function Entry({icon, title, detail, onClick, disabled, badge}: {icon:ReactNode; title:string; detail:string; onClick:()=>void; disabled:boolean; badge?:string}) {
  const descriptionId = useId();
  return <button type="button" className="personal-entry" aria-label={title} aria-describedby={`${descriptionId}-detail${badge ? ` ${descriptionId}-badge` : ''}`} onClick={onClick} disabled={disabled}>
    <span className="personal-entry-icon" aria-hidden="true">{icon}</span><span className="personal-entry-copy"><strong>{title}</strong><small id={`${descriptionId}-detail`}>{detail}</small></span>
    {badge && <span id={`${descriptionId}-badge`} className="personal-entry-badge">{badge}</span>}<ChevronRight size={18} aria-hidden="true"/>
  </button>;
}

export function PersonalPage({snapshot, busy, syncLabel, onSection, onStats, onRead, onSave}: {
  snapshot: LearningSnapshot; busy:boolean; syncLabel:string; onSection:(section:PersonalSection)=>void; onStats:()=>void; onRead:()=>void; onSave:(profile:PersonalProfile)=>Promise<void>;
}) {
  const {profile, state, user} = snapshot;
  const totals = useMemo(() => personalTotals(state!), [state?.reading, state?.events]);
  const [editing,setEditing] = useState(false);
  const [draft,setDraft] = useState<PersonalProfile>(()=>({...profile}));
  const [saving,setSaving] = useState(false);
  const [error,setError] = useState('');
  const savingRef = useRef(false);
  const [processingPhoto,setProcessingPhoto]=useState(false);
  const photoInput=useRef<HTMLInputElement>(null);
  const dirty = draft.nickname !== profile.nickname || draft.signature !== profile.signature || draft.avatar !== profile.avatar || draft.avatarDataUrl !== profile.avatarDataUrl;
  const name = profile.nickname || user?.name || '学习者';
  const hasLearning = totals.passages + totals.encountered + totals.practices > 0;
  function edit() { if (!dirty) setDraft({...profile}); setError(''); setEditing(true); }
  async function choosePhoto(file?:File) {
    if(!file||savingRef.current||busy)return;
    savingRef.current=true;setProcessingPhoto(true);setError('');
    try{const avatarDataUrl=await prepareAvatar(file);setDraft(current=>({...current,avatar:'custom',avatarDataUrl}));}
    catch(error){setError(error instanceof Error?error.message:'照片未能读取，请重试。');}
    finally{savingRef.current=false;setProcessingPhoto(false);if(photoInput.current)photoInput.current.value='';}
  }
  async function save() {
    if (savingRef.current || busy) return;
    savingRef.current = true; setSaving(true); setError('');
    try {
      const value = profileSchema.parse(draft);
      await onSave(value);
      setDraft(value); setEditing(false);
    } catch (error) {
      setError(error instanceof Error ? error.message : '资料未保存，输入已保留，请重试。');
    } finally { savingRef.current = false; setSaving(false); }
  }
  return <div className="personal-home">
    <header className="personal-heading"><span className="ww-eyebrow">A SPACE OF YOUR OWN</span><h1 tabIndex={-1}>我的学习空间</h1><p>把每一点积累，留给更好的自己。</p></header>
    <section className="personal-identity" aria-label="个人资料">
      <div className="personal-identity-top"><Avatar kind={profile.avatar} photo={profile.avatarDataUrl} name={name}/><div className="personal-name"><h2>{name}</h2><span>词间学习者</span></div><button type="button" className="personal-edit" aria-label="编辑个人资料" onClick={edit} disabled={busy}><Pencil size={15}/><span>编辑</span></button></div>
      <p className="personal-signature">{profile.signature || '在句子里相遇，在回忆中熟悉。'}</p>
      <div className="personal-identity-foot"><span><Leaf size={13}/>一点积累，一点熟悉</span>{dirty && <small>有未保存的资料草稿</small>}</div>
    </section>
    <section className="personal-progress" aria-labelledby="personal-progress-title">
      <div className="personal-section-heading"><h2 id="personal-progress-title">学习的足迹</h2><button type="button" onClick={onStats} disabled={busy}>查看记录<ArrowUpRight size={15}/></button></div>
      <dl className="personal-totals"><div><dt>已读篇数</dt><dd data-profile-total="passages">{totals.passages.toLocaleString()}</dd></div><div><dt>接触词数</dt><dd data-profile-total="encountered">{totals.encountered.toLocaleString()}</dd></div><div><dt>练习次数</dt><dd data-profile-total="practices">{totals.practices.toLocaleString()}</dd></div></dl>
      {hasLearning ? <p className="personal-caption">累计全部学习记录 · 阅读接触不代表已掌握</p> : <div className="personal-empty"><p>还没有学习足迹，从一篇阅读开始吧。</p><button type="button" onClick={onRead} disabled={busy}>开始阅读<ChevronRight size={14}/></button></div>}
    </section>
    <section className="personal-entries" aria-label="个人主页功能">
      <Entry icon={<Users size={20}/>} title="我的好友" detail="和好友一起，慢慢积累" onClick={()=>onSection('friends')} disabled={busy}/>
      <Entry icon={<Settings2 size={20}/>} title="学习偏好" detail={`${state!.settings.level === 'CET4' ? '四级' : '六级'}词表 · 每日 ${state!.settings.daily} 个新词`} onClick={()=>onSection('settings')} disabled={busy}/>
      <Entry icon={<Cloud size={20}/>} title="同步与账号" detail={snapshot.conflicts.length ? `${snapshot.conflicts.length} 项冲突需要处理` : snapshot.pending ? `${snapshot.pending} 项记录等待同步` : '让学习记录安心保存'} badge={syncLabel} onClick={()=>onSection('sync')} disabled={busy}/>
      <Entry icon={<Database size={20}/>} title="数据与备份" detail="导入词表、导出与恢复学习记录" onClick={()=>onSection('data')} disabled={busy}/>
      <Entry icon={<Info size={20}/>} title="关于词间" detail="应用信息与内容说明" onClick={()=>onSection('about')} disabled={busy}/>
    </section>
    <p className="personal-home-note">按照自己的节奏，慢慢来。</p>
    <Presence show={editing} portal><Modal title="编辑个人资料" onClose={()=>{if(!savingRef.current&&!busy)setEditing(false);}}>
      <form className="personal-form" onSubmit={event=>{event.preventDefault();void save();}}>
        <div className="personal-form-intro"><Avatar kind={draft.avatar} photo={draft.avatarDataUrl} name={draft.nickname || user?.name || '我'}/><div><h2>让这里，更像你</h2><p>头像、昵称和签名先保存在此设备。</p></div></div>
        <input ref={photoInput} type="file" accept="image/jpeg,image/png,image/webp" aria-label="选择头像照片" hidden onChange={event=>void choosePhoto(event.target.files?.[0])}/>
        <button type="button" className="ww-button ww-secondary personal-photo-button" onClick={()=>photoInput.current?.click()} disabled={saving||busy||processingPhoto}><ImagePlus size={18}/>{processingPhoto?'正在处理照片…':'从手机选择照片'}</button>
        <p className="personal-field-hint">照片居中裁成方形并缩小保存，支持 JPG、PNG、WebP，最大 10 MB。</p>
        <fieldset className="personal-avatar-picker" disabled={saving || busy || processingPhoto}><legend>或选择内置头像</legend><div role="radiogroup" aria-label="选择头像" onKeyDown={event=>{
          const index=avatars.findIndex(avatar=>avatar.id===draft.avatar);
          const next=event.key==='Home'?0:event.key==='End'?avatars.length-1:['ArrowRight','ArrowDown'].includes(event.key)?(index+1)%avatars.length:['ArrowLeft','ArrowUp'].includes(event.key)?(index+avatars.length-1)%avatars.length:-1;
          if(next<0||saving||busy||processingPhoto)return;event.preventDefault();setDraft({...draft,avatar:avatars[next].id,avatarDataUrl:undefined});event.currentTarget.querySelectorAll<HTMLButtonElement>('button')[next]?.focus();
        }}>{avatars.map(({id,label,Icon},index)=><button type="button" role="radio" aria-checked={draft.avatar===id} aria-label={label} tabIndex={draft.avatar===id||draft.avatar==='custom'&&index===0?0:-1} key={id} onClick={()=>setDraft({...draft,avatar:id,avatarDataUrl:undefined})}><span>{Icon ? <Icon size={22} strokeWidth={1.5}/> : [...(draft.nickname || user?.name || '我')][0]}</span><small>{label}</small>{draft.avatar===id&&<Check className="personal-avatar-check" size={12}/>}</button>)}</div></fieldset>
        <label htmlFor="personal-nickname">昵称<span>{draft.nickname.length}/24</span></label><input id="personal-nickname" aria-label="昵称" autoComplete="nickname" maxLength={24} value={draft.nickname} placeholder={user?.name || '给自己起个昵称'} disabled={saving || busy} onChange={event=>setDraft({...draft,nickname:event.target.value})}/>
        <p className="personal-field-hint">留空使用账号名；登录用户名仍为「{user?.name}」。</p>
        <label htmlFor="personal-signature">个人签名<span>{draft.signature.length}/80</span></label><textarea id="personal-signature" aria-label="个人签名" rows={3} maxLength={80} value={draft.signature} placeholder="写一句此刻想对自己说的话" disabled={saving || busy} onChange={event=>setDraft({...draft,signature:event.target.value})}/>
        <p className="personal-field-hint">本机资料不包含在学习备份中。可在「我的好友 → 我的展示」主动发布给好友。关闭编辑会保留本次草稿。</p>
        {error&&<p className="ww-error" role="alert">{error}</p>}
        <div className="personal-form-actions"><button type="button" className="ww-button ww-ghost" disabled={!dirty||saving||busy||processingPhoto} onClick={()=>{setDraft({...profile});setError('');}}>放弃修改</button><button type="submit" className="ww-button ww-primary" disabled={!dirty||saving||busy||processingPhoto}>{saving?'正在保存…':'保存资料'}</button></div>
      </form>
    </Modal></Presence>
  </div>;
}

export function PersonalDetail({title,subtitle,onBack,busy,children}: {title:string;subtitle:string;onBack:()=>void;busy:boolean;children:ReactNode}) {
  return <div className="personal-detail"><header className="personal-detail-heading"><button type="button" className="ww-icon-button ww-bordered" onClick={onBack} disabled={busy} aria-label="返回个人主页"><ChevronLeft size={22}/></button><div><h1 tabIndex={-1}>{title}</h1><p>{subtitle}</p></div></header><div className="personal-detail-content">{children}</div></div>;
}
