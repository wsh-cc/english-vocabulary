import type {State,Word,Mode} from '@/lib/learning';
export type Save=(action:Record<string,unknown>)=>Promise<boolean>;
export type AppProps={state:State;save:Save;busy:boolean;cancelPending?:()=>void};
export type QueueItem={word:Word;mode:Mode};

export type StateSnapshot={state:State;revision:number;user?:{name:string};etag?:string|null};
// False means the request belongs to an expired session, not just an older revision.
export type CaptureSnapshot=()=>((snapshot:StateSnapshot,etag:string|null)=>boolean);
