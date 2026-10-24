import type {State,Word,Mode} from '@/lib/learning';
export type Save=(action:Record<string,unknown>)=>Promise<boolean>;
export type AppProps={state:State;save:Save;busy:boolean;cancelPending?:()=>void};
export type QueueItem={word:Word;mode:Mode};
export type DeferredView='learn'|'library'|'stats'|'review'|'my'|'friends'|'appearance';

export type StateSnapshot={state:State;revision:number;user?:{name:string;userId?:string};etag?:string|null};
// Null means the request belongs to an expired session. Otherwise return the
// latest accepted snapshot so reading can detect a newer concurrent refresh.
export type CaptureSnapshot=()=>((snapshot:StateSnapshot,etag:string|null)=>Pick<StateSnapshot,'state'|'revision'>|null);
