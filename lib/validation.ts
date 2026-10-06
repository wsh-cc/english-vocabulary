import { z } from 'zod';
import { seedWords } from './learning';
const id=z.string().regex(/^[a-zA-Z0-9_-]{1,120}$/).refine(v=>!['__proto__','constructor','prototype'].includes(v),'无效编号');
const str=(max=500)=>z.string().max(max);
const url=z.string().max(500).refine(v=>v===''||/^https?:\/\//.test(v),'来源链接需使用 http 或 https');
export const wordSchema=z.object({id,word:z.string().min(1).max(80).regex(/^[a-zA-Z][a-zA-Z '-]*$/),pos:z.enum(['n.','v.','adj.','adv.','prep.','conj.','pron.','interj.']),meaning:str(200).min(1),collocation:str(200).min(1),example:str(500).min(1),translation:str(500).min(1),test:str(500).min(1),testTranslation:str(500).min(1),phonetic:str(100),tags:z.array(z.enum(['CET4','CET6'])).min(1).max(2),source:str(200).min(1),version:str(100).min(1),sourceUrl:url,scene:str(100),mnemonic:str(1000)});
const settings=z.object({level:z.enum(['CET4','CET6']),daily:z.number().int().min(1).max(30),length:z.enum(['long','short']),count:z.number().int().min(6).max(10),gloss:z.enum(['click','direct']),onboarded:z.boolean()});
const timestamp=z.number().int().min(0).max(8640000000000000);
const track=z.object({due:timestamp,streak:z.number().int().min(0).max(100000),attempts:z.number().int().min(0),correct:z.number().int().min(0),hinted:z.number().int().min(0),wrong:z.number().int().min(0),last:timestamp,interval:timestamp});
const mode=z.enum(['meaning','recall','context']);
const result=z.object({id,wordId:id,mode,outcome:z.enum(['correct','hinted','wrong']),at:timestamp,delayed:z.boolean(),answer:str(1000),nextDue:timestamp});
export const stateSchema=z.object({version:z.literal(1),settings,progress:z.record(id,z.object({meaning:track.optional(),recall:track.optional(),context:track.optional()})),notes:z.record(id,str(1000)),familiar:z.record(id,z.enum(['familiar','unknown','learning'])),learned:z.record(id,timestamp),custom:z.array(wordSchema).max(2000),events:z.array(result).max(50000),operations:z.array(id).max(1000)}).superRefine((s,ctx)=>{const base=new Set(seedWords.map(w=>w.id));const known=new Set(base);for(const w of s.custom){if(known.has(w.id))ctx.addIssue({code:'custom',message:'备份中有重复义项编号'});known.add(w.id);}for(const key of [...Object.keys(s.progress),...Object.keys(s.notes),...Object.keys(s.familiar),...Object.keys(s.learned),...s.events.map(e=>e.wordId)])if(!known.has(key))ctx.addIssue({code:'custom',message:'备份含未知词汇记录'});});
const operationId=id;
export const actionSchema=z.discriminatedUnion('type',[
z.object({type:z.literal('settings'),operationId,settings:settings.partial()}),
z.object({type:z.literal('introduce'),operationId,ids:z.array(id).min(1).max(100)}),
z.object({type:z.literal('familiar'),operationId,wordId:id,value:z.enum(['familiar','unknown','learning'])}),
z.object({type:z.literal('note'),operationId,wordId:id,note:str(1000)}),
z.object({type:z.literal('result'),operationId,wordId:id,mode,outcome:z.enum(['correct','hinted','wrong']),answer:str(1000)}),
z.object({type:z.literal('import'),operationId,words:z.array(wordSchema).min(1).max(500)}),
z.object({type:z.literal('restore'),operationId,backup:stateSchema,revision:z.number().int().min(0)})]);

