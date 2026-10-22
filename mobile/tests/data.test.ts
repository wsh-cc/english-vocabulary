import { describe, it, expect } from 'vitest';
import { LearningRepository, RemoteError, type Remote } from '../src/data';
import { createBrowserPersistence, type StatePersistence, type StoredState } from '../src/native';
import { initialState, applyAction, seedWords, DAY, type State } from '@/lib/learning';
import { readingPassages } from '@/lib/curriculum';
import { MOBILE_CONTENT_VERSION, type MobileSnapshot, type MobileOperation } from '@/lib/mobile-protocol';
import { defaultProfile, type PersonalProfile } from '../src/profile';

class Disk implements StatePersistence {
  value: StoredState={stateJson:null,revision:0,recoveryJson:null};
  fail=false;
  async readState(){return structuredClone(this.value);}
  async writeState(input:Parameters<StatePersistence['writeState']>[0]){
    if(this.fail)throw Error('disk full');
    if(input.expectedRevision!==this.value.revision)throw Error('revision conflict');
    this.value={stateJson:input.stateJson,revision:this.value.revision+1,recoveryJson:input.keepRecovery?this.value.stateJson:this.value.recoveryJson};
    return {revision:this.value.revision};
  }
}
const baseTime=Date.parse('2026-10-13T00:00:00Z');
class Cloud implements Remote {
  token:string|null=null;
  fail:number|false=false;
  calls:MobileOperation[][]=[];
  current:MobileSnapshot={state:initialState(),revision:0,generation:1,user:{userId:'owner',name:'学习者'},serverTime:baseTime,contentVersion:MOBILE_CONTENT_VERSION,protocolVersion:1};
  gate:(()=>Promise<void>)|null=null;
  async readToken(){return this.token;}
  async writeToken(token:string|null){this.token=token;}
  async request(path:string,_method:string,input?:unknown){
    const body=input as {backup:State;operations:MobileOperation[]};
    if(this.fail)throw new RemoteError('network unavailable',this.fail);
    if(path==='auth')return {token:'a'.repeat(64),user:this.current.user,expiresAt:baseTime+14*DAY};
    if(path==='bootstrap')return structuredClone(this.current);
    if(path==='restore'){
      this.current={...this.current,state:body.backup,revision:this.current.revision+1,generation:this.current.generation+1};
      return structuredClone(this.current);
    }
    this.calls.push(structuredClone(body.operations));
    if(this.gate)await this.gate();
    const accepted:string[]=[];
    for(const op of body.operations as MobileOperation[]){
      let action=op.action;
      if(action.type==='reading-complete')action={type:'reading-complete',passage:readingPassages.find(p=>p.id===action.passageId)};
      if(!this.current.state.operations.includes(op.operationId)){
        this.current.state=applyAction(this.current.state,{...action,operationId:op.operationId},op.occurredAt);
        this.current.revision++;
      }
      accepted.push(op.operationId);
    }
    return {...structuredClone(this.current),accepted,conflicts:[],idMap:{}};
  }
}
async function fixture(){
  const disk=new Disk();const cloud=new Cloud();let time=baseTime;let sequence=0;
  const repo=new LearningRepository(disk,cloud,()=>time,()=>`test-${++sequence}`);
  await repo.login('owner','password-password');
  return {disk,cloud,repo,setTime:(value:number)=>{time=value;}};
}
describe('offline account repository',()=>{
  it('requires successful first login; reconnect cold-start preserves offline results',async()=>{
    const {disk,cloud,repo,setTime}=await fixture();cloud.fail=503;setTime(baseTime+DAY);
    await repo.dispatch({type:'result',wordId:seedWords[0].id,mode:'meaning',outcome:'correct',answer:'test',operationId:'result-one'});
    await repo.sync();expect(repo.snapshot.pending).toBe(1);
    const reopened=new LearningRepository(disk,cloud,()=>baseTime+DAY);
    await reopened.read();expect(reopened.snapshot.state!.events[0].at).toBe(baseTime+DAY);
    cloud.fail=false;await reopened.sync();expect(reopened.snapshot.pending).toBe(0);expect(cloud.current.state.events).toHaveLength(1);
  });
  it('failed local transaction does not mutate scores; retry UUID counts once',async()=>{
    const {disk,repo}=await fixture();disk.fail=true;
    const action={type:'result',wordId:seedWords[0].id,mode:'meaning',outcome:'correct',answer:'test',operationId:'stable-result'};
    await expect(repo.dispatch(action)).rejects.toThrow('disk full');expect(repo.snapshot.state!.events).toHaveLength(0);expect(repo.snapshot.pending).toBe(0);
    disk.fail=false;await repo.dispatch(action);await repo.dispatch(action);expect(repo.snapshot.state!.events).toHaveLength(1);expect(repo.snapshot.pending).toBe(1);
  });
  it('401 only pauses synchronization and keeps the account, notes and queue',async()=>{
    const {repo,cloud}=await fixture();await repo.dispatch({type:'note',wordId:seedWords[0].id,note:'my note'});cloud.fail=401;
    await repo.sync();expect(repo.snapshot.needsLogin).toBe(true);expect(repo.snapshot.state!.notes[seedWords[0].id]).toBe('my note');expect(repo.snapshot.pending).toBe(1);
  });
  it('new local work arriving during a remote response is not erased',async()=>{
    const {repo,cloud}=await fixture();await repo.dispatch({type:'note',wordId:seedWords[0].id,note:'first'});
    let release!:()=>void;let entered!:()=>void;const entry=new Promise<void>(r=>{entered=r;});
    cloud.gate=()=>{cloud.gate=null;entered();return new Promise<void>(r=>{release=r;});};
    const syncing=repo.sync();await entry;
    await repo.dispatch({type:'note',wordId:seedWords[1].id,note:'second'});release();await syncing;
    expect(repo.snapshot.state!.notes[seedWords[1].id]).toBe('second');expect(cloud.current.state.notes[seedWords[1].id]).toBe('second');expect(repo.snapshot.pending).toBe(0);
  });
  it('lost acknowledgement is recoverable without duplicate remote scoring',async()=>{
    const {repo,cloud,disk}=await fixture();await repo.dispatch({type:'result',wordId:seedWords[0].id,mode:'meaning',outcome:'wrong',answer:'test'});
    disk.fail=true;await repo.sync();expect(cloud.current.state.events).toHaveLength(1);expect(repo.snapshot.pending).toBe(1);
    disk.fail=false;await repo.sync(true);expect(repo.snapshot.pending).toBe(0);expect(repo.snapshot.state!.events).toHaveLength(1);
  });
  it('read completion uses bundled content and does not create practice scores',async()=>{
    const {repo}=await fixture();const p=readingPassages[0];await repo.dispatch({type:'reading-complete',passage:{...p,wordIds:['malicious']}});
    expect(repo.snapshot.state!.reading!.completed[p.id]).toBe(baseTime);expect(repo.snapshot.state!.events).toHaveLength(0);expect(repo.snapshot.state!.reading!.encounters[p.wordIds[0]]).toBeDefined();
    await expect(repo.dispatch({type:'reading-complete',passageId:'missing'})).rejects.toThrow();
  });
  it('reopens an old offline reading queue, replays it on current content and preserves its wire version',async()=>{
    const {disk,cloud,repo,setTime}=await fixture();
    const oldPassage=readingPassages[0];
    const newPassage=readingPassages.find(p=>p.level==='CET4'&&p.wordIds.some(id=>id.startsWith('cet4-common-')));
    expect(newPassage,'the expanded CET4 reading content is bundled').toBeDefined();
    setTime(baseTime+DAY);
    await repo.dispatch({type:'reading-complete',passageId:oldPassage.id,operationId:'old-apk-reading'});
    const saved=JSON.parse(disk.value.stateJson!);
    saved.outbox[0].action.contentVersion='wordweave-2026-10-v1';
    disk.value.stateJson=JSON.stringify(saved);
    const legacyWire=structuredClone(saved.outbox[0]);
    const reopened=new LearningRepository(disk,cloud,()=>baseTime+DAY,()=> 'new-apk-reading');
    await reopened.read();
    expect(reopened.snapshot.pending).toBe(1);
    cloud.current.serverTime=baseTime+DAY;
    await reopened.login('owner','password-password');
    expect(reopened.snapshot.error).toBe('');
    expect(reopened.snapshot.pending).toBe(0);
    expect(cloud.calls.flat().find(op=>op.operationId==='old-apk-reading')).toEqual(legacyWire);
    expect(reopened.snapshot.state!.reading!.completed[oldPassage.id]).toBe(baseTime+DAY);
    expect(reopened.snapshot.state!.reading!.encounters[oldPassage.wordIds[0]]).toEqual({count:1,last:baseTime+DAY});
    await reopened.dispatch({type:'reading-complete',passageId:newPassage!.id});
    await reopened.sync(true);
    expect(reopened.snapshot.pending).toBe(0);
    expect(cloud.calls.flat().find(op=>op.operationId==='new-apk-reading')!.action.contentVersion).toBe(MOBILE_CONTENT_VERSION);
    expect(reopened.snapshot.state!.reading!.completed[newPassage!.id]).toBe(baseTime+DAY);
    expect(reopened.snapshot.state!.events).toHaveLength(0);
  });
  it('rejects an unknown queued reading version without replacing the saved offline accomplishments',async()=>{
    const {disk,cloud,repo}=await fixture();
    await repo.dispatch({type:'reading-complete',passageId:readingPassages[0].id});
    const saved=JSON.parse(disk.value.stateJson!);
    saved.outbox[0].action.contentVersion='wordweave-unknown-content';
    disk.value.stateJson=JSON.stringify(saved);
    const before=structuredClone(disk.value);
    const reopened=new LearningRepository(disk,cloud,()=>baseTime);
    await expect(reopened.login('owner','password-password')).rejects.toThrow('阅读内容版本不匹配');
    expect(disk.value).toEqual(before);
    expect(reopened.snapshot.pending).toBe(1);
    expect(reopened.snapshot.state!.reading!.completed[readingPassages[0].id]).toBe(baseTime);
  });
  it.each(['wordweave-2026-10-v1','wordweave-unknown-content'])('rejects a login snapshot with outdated or unknown content version %s',async(contentVersion)=>{
    const disk=new Disk(),cloud=new Cloud();
    cloud.current.contentVersion=contentVersion;
    const repo=new LearningRepository(disk,cloud,()=>baseTime);
    await expect(repo.login('owner','password-password')).rejects.toThrow('安装最新版本');
    expect(disk.value.stateJson).toBeNull();
    expect(cloud.token).toBeNull();
  });
  it('generation change protects pending local accomplishments until deliberate reload',async()=>{
    const {repo,cloud,disk}=await fixture();await repo.dispatch({type:'note',wordId:seedWords[0].id,note:'offline accomplishment'});
    cloud.current.generation=2;cloud.current.state=initialState();
    cloud.request=async()=>({...structuredClone(cloud.current),accepted:[],conflicts:[],idMap:{}});
    await repo.sync();expect(repo.snapshot.conflicts[0].code).toBe('generation');expect(repo.exportBackup().text).toContain('offline accomplishment');
    await repo.reloadAfterRestore();expect(repo.snapshot.pending).toBe(0);expect(disk.value.recoveryJson).toContain('offline accomplishment');
  });
  it('old backups and hidden data round-trip, failed parsing changes nothing',async()=>{
    const {repo}=await fixture();const state=initialState();delete state.reading;state.notes[seedWords[0].id]='saved note';state.settings.count=12;
    const preview=repo.previewBackup(JSON.stringify({app:'wordweave',schema:1,state,catalog:['ignored']}));await repo.restore(preview);
    const exported=JSON.parse(repo.exportBackup().text);expect(exported.state.notes[seedWords[0].id]).toBe('saved note');expect(exported.state.settings.count).toBe(12);expect(exported.catalog).toBeUndefined();
    expect(()=>repo.previewBackup('{bad')).toThrow();expect(()=>repo.previewBackup(JSON.stringify({app:'wordweave',schema:2,state}))).toThrow();expect(repo.snapshot.state!.notes[seedWords[0].id]).toBe('saved note');
  });
  it('browser fallback uses a single atomic storage envelope and rejects corrupt data',async()=>{
    const map=new Map<string,string>();const storage={getItem:(key:string)=>map.get(key)??null,setItem:(key:string,val:string)=>{map.set(key,val);}};
    const store=createBrowserPersistence(storage);await store.writeState({stateJson:'first',expectedRevision:0});await store.writeState({stateJson:'second',expectedRevision:1,keepRecovery:true});
    expect(await store.readState()).toEqual({stateJson:'second',revision:2,recoveryJson:'first'});await expect(store.writeState({stateJson:'third',expectedRevision:1})).rejects.toThrow();
    map.set('wordweave-mobile-state-v1','{"revision":-1}');await expect(store.readState()).rejects.toThrow();
  });
});

describe('account-scoped local personal profile', () => {
  const profile: PersonalProfile = {nickname: '林间读者', signature: '每天读一点。', avatar: 'sprout'};

  it('opens an older account envelope with default presentation without rewriting its learning data', async () => {
    const {disk, cloud} = await fixture();
    const before = structuredClone(disk.value);
    const reopened = new LearningRepository(disk, cloud);
    await reopened.read();
    expect(reopened.snapshot.profile).toEqual(defaultProfile());
    expect(disk.value).toEqual(before);
  });

  it('persists offline, normalizes input and leaves learning sync and backup formats untouched', async () => {
    const {disk, cloud, repo} = await fixture();
    const state = repo.snapshot.state;
    const calls = cloud.calls.length;
    cloud.fail = 503;
    await repo.saveProfile({...profile, nickname: '  林间读者  ', signature: '  每天读一点。  '});
    expect(repo.snapshot.profile).toEqual(profile);
    expect(repo.snapshot.state).toBe(state);
    expect(repo.snapshot.pending).toBe(0);
    expect(cloud.calls).toHaveLength(calls);
    expect(JSON.parse(repo.exportBackup().text)).toEqual({app: 'wordweave', schema: 1, exportedAt: new Date(baseTime).toISOString(), state});
    const reopened = new LearningRepository(disk, cloud);
    await reopened.read();
    expect(reopened.snapshot.profile).toEqual(profile);
    const exposed = reopened.snapshot.profile;
    exposed.nickname = 'accidental mutation';
    expect(reopened.snapshot.profile).toEqual(profile);
  });

  it('does not publish success on disk failure and retries without losing the previous profile', async () => {
    const {disk, repo} = await fixture();
    await repo.saveProfile(profile);
    const before = structuredClone(disk.value);
    let notifications = 0;
    const unsubscribe = repo.subscribe(() => notifications++);
    disk.fail = true;
    await expect(repo.saveProfile({...profile, nickname: '新的昵称'})).rejects.toThrow('disk full');
    expect(repo.snapshot.profile).toEqual(profile);
    expect(disk.value).toEqual(before);
    expect(notifications).toBe(0);
    disk.fail = false;
    await repo.saveProfile({...profile, nickname: '新的昵称'});
    expect(repo.snapshot.profile.nickname).toBe('新的昵称');
    expect(notifications).toBe(1);
    unsubscribe();
  });

  it('preserves profile edits committed while a learning sync response is in flight', async () => {
    const {cloud, repo} = await fixture();
    let release!: () => void;
    let entered!: () => void;
    const entry = new Promise<void>(resolve => { entered = resolve; });
    cloud.gate = () => { cloud.gate = null; entered(); return new Promise<void>(resolve => { release = resolve; }); };
    const syncing = repo.sync(true);
    await entry;
    await repo.saveProfile(profile);
    release();
    await syncing;
    expect(repo.snapshot.profile).toEqual(profile);
  });

  it('locks presentation on logout, rejects writes, and restores it on same-account login and learning restore', async () => {
    const {repo} = await fixture();
    await repo.saveProfile(profile);
    await repo.logout();
    expect(repo.snapshot.profile).toEqual(defaultProfile());
    await expect(repo.saveProfile({...profile, nickname: 'blocked'})).rejects.toThrow('请先登录');
    await repo.login('owner', 'password-password');
    expect(repo.snapshot.profile).toEqual(profile);
    await repo.restore(repo.previewBackup(JSON.stringify({app: 'wordweave', schema: 1, state: initialState()})));
    expect(repo.snapshot.profile).toEqual(profile);
  });

  it.each([
    {...profile, userId: 'another-account'},
    {...profile, userId: 'owner', nickname: 'x'.repeat(25)},
    {...profile, userId: 'owner', avatar: 'https://untrusted.example/avatar'},
  ])('ignores a foreign or invalid optional profile without blocking saved learning', async (localProfile) => {
    const {disk, cloud, repo} = await fixture();
    await repo.dispatch({type: 'note', wordId: seedWords[0].id, note: '保留的学习记录'});
    disk.value.stateJson = JSON.stringify({...JSON.parse(disk.value.stateJson!), localProfile});
    const reopened = new LearningRepository(disk, cloud);
    await reopened.read();
    expect(reopened.snapshot.profile).toEqual(defaultProfile());
    expect(reopened.snapshot.state!.notes[seedWords[0].id]).toBe('保留的学习记录');
    await reopened.saveProfile(profile);
    expect(JSON.parse(disk.value.stateJson!).localProfile).toEqual({userId: 'owner', ...profile});
  });

  it.each([
    {...profile, nickname: 'x'.repeat(25)},
    {...profile, signature: 'x'.repeat(81)},
  ])('rejects oversized edits without changing disk or snapshot', async input => {
    const {disk, repo} = await fixture();
    const before = structuredClone(disk.value);
    await expect(repo.saveProfile(input)).rejects.toThrow('最多');
    expect(disk.value).toEqual(before);
    expect(repo.snapshot.profile).toEqual(defaultProfile());
  });

  it('rejects profile writes before the first account has been downloaded', async () => {
    const disk = new Disk(), cloud = new Cloud();
    const repo = new LearningRepository(disk, cloud);
    await expect(repo.saveProfile(profile)).rejects.toThrow('请先登录');
    expect(disk.value.stateJson).toBeNull();
  });
});
