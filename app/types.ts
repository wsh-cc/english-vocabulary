import type {State,Word,Mode} from '@/lib/learning';
export type Save=(action:Record<string,unknown>)=>Promise<boolean>;
export type AppProps={state:State;save:Save;busy:boolean;cancelPending?:()=>void};
export type QueueItem={word:Word;mode:Mode};
