import fs from 'node:fs';
import { createHash } from 'node:crypto';
const catalog=JSON.parse(fs.readFileSync('content/catalog.json','utf8'));
const groups=JSON.parse(fs.readFileSync('content/reading-groups.json','utf8'));
const sources=fs.readFileSync('content/readings-source.jsonl','utf8').trim().split(/\r?\n/).map(line=>JSON.parse(line));
const expansion=JSON.parse(fs.readFileSync('content/cet4-expansion.json','utf8'));
const cet6Expansion=JSON.parse(fs.readFileSync('content/cet6-exam-expansion.json','utf8'));
for(const group of expansion.groups){
 const targets=group.words.split(' ').map(spelling=>catalog.words.find(word=>word.word===spelling&&word.id.startsWith('cet4-common-')));
 if(targets.some(word=>!word))throw Error(`${group.id}: missing expansion word`);
 groups.push({id:group.id,level:'CET4',theme:group.category,wordIds:targets.map(word=>word.id)});
 sources.push({batch:group.id,title:group.title,text:group.text});
}
for(const group of cet6Expansion.groups){
 const targets=group.words.split(' ').map(spelling=>catalog.words.find(word=>word.word===spelling&&word.id.startsWith('cet6-exam-')));
 if(targets.some(word=>!word))throw Error(`${group.id}: missing CET6 exam word`);
 groups.push({id:group.id,level:'CET6',theme:group.category,wordIds:targets.map(word=>word.id)});
 sources.push({batch:group.id,title:group.title,text:group.text});
}
const byId=new Map(catalog.words.map(word=>[word.id,word]));
const byBatch=new Map(sources.map(source=>[source.batch,source]));
if(byBatch.size!==sources.length)throw Error('Duplicate authored batch.');
if(new Set(groups.map(group=>group.id)).size!==groups.length)throw Error('Duplicate curriculum group.');
if(sources.some(source=>!groups.some(group=>group.id===source.batch)))throw Error('Unknown authored batch.');
const uuid=(value)=>{const hash=createHash('sha256').update('wordweave-reading-v1:'+value).digest('hex').slice(0,32);return `${hash.slice(0,8)}-${hash.slice(8,12)}-5${hash.slice(13,16)}-a${hash.slice(17,20)}-${hash.slice(20)}`;};
const readings=[];
for(const group of groups){
 const source=byBatch.get(group.id);
 if(!source){console.log('PENDING '+group.id);continue;}
 const targets=group.wordIds.map(id=>byId.get(id));
 if(targets.length<20||targets.length>40||targets.some(word=>!word||!word.tags.includes(group.level))||new Set(group.wordIds).size!==targets.length)throw Error(`${group.id}: invalid targets`);
 const used=new Set();const occurrence=new Map();
 const text=source.text.replace(/\{([^{}]+)\}/g,(_,spelling)=>{
  const matching=targets.filter(word=>word.word===spelling);
  if(!matching.length)throw Error(`${group.id}: unknown target ${spelling}`);
  const offset=occurrence.get(spelling)??0;occurrence.set(spelling,offset+1);
  const target=matching[Math.min(offset,matching.length-1)];used.add(target.id);return `[[${target.id}]]`;
 });
 const missing=targets.filter(word=>!used.has(word.id));
 if(missing.length)throw Error(`${group.id}: missing ${missing.map(word=>word.word).join(', ')}`);
 const prose=text.replace(/\[\[[a-zA-Z0-9_-]+\]\]/g,'');
 if(/[\[\]{}]/.test(prose)||(prose.match(/[\u3400-\u9fff]/g)?.length??0)<targets.length*5||(prose.match(/[\u3002\uff01\uff1f]/g)?.length??0)<4)throw Error(`${group.id}: insufficient prose`);
 readings.push({id:uuid(group.id),batch:group.id,title:source.title,text,wordIds:group.wordIds,level:group.level,createdAt:group.id.startsWith('cet6-exam-')?Date.parse(cet6Expansion.authoredAt+'T00:00:00+08:00'):group.id.startsWith('cet4-common-')?Date.parse(expansion.authoredAt+'T00:00:00+08:00'):1791417600000});
}
fs.writeFileSync('content/readings.json',JSON.stringify({version:3,authoredAt:cet6Expansion.authoredAt,passages:readings},null,2)+'\n');
const covered=new Set(readings.flatMap(reading=>reading.wordIds));
console.log(`Compiled ${readings.length}/${groups.length} paragraphs, ${covered.size}/${catalog.words.length} senses.`);
if(process.argv.includes('--complete')&&covered.size!==catalog.words.length)throw Error('The curriculum must cover every dictionary sense.');
