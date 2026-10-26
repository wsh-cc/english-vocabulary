import fs from 'node:fs';

const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const catalog = read('content/catalog.json');
const expansion = read('content/cet6-exam-expansion.json');
const evidence = read('content/sources/cet6-exam-evidence.json');
const rows = fs.readFileSync('content/cet6-exam-expansion.tsv', 'utf8').trim().split(/\r?\n/);
const prefix = 'cet6-exam-';
const retained = catalog.words.filter(word => !word.id.startsWith(prefix));
const spellings = new Set(retained.map(word => word.word.toLowerCase()));
const papers = new Map(evidence.papers.map(paper => [paper.id, paper]));
const occurrences = new Map(evidence.entries.map(entry => [entry.word, entry]));
const groups = new Map();
const scenes = expansion.groups.map(group => {
  if (!group.id.startsWith(prefix)) throw Error(`Invalid CET6 group: ${group.id}`);
  const words = group.words.split(' ');
  for (const word of words) {
    if (groups.has(word)) throw Error(`Repeated CET6 target: ${word}`);
    groups.set(word, group);
  }
  return {id: group.id, title: group.title, category: group.category, text: group.text, words};
});
const added = rows.map((line, index) => {
  const fields = line.split('|');
  if (fields.length !== 8 || fields.some(field => !field.trim())) throw Error(`Incomplete CET6 row ${index + 1}`);
  const [word, pos, meaning, collocation, example, translation, test, testTranslation] = fields;
  if (spellings.has(word.toLowerCase())) throw Error(`Duplicate CET6 spelling: ${word}`);
  spellings.add(word.toLowerCase());
  const record = occurrences.get(word), group = groups.get(word);
  if (!record || !record.phonetic || !group || record.evidence.length < 2) throw Error(`Missing exam evidence: ${word}`);
  const references = record.evidence.map(item => {
    const paper = papers.get(item.paper);
    if (!paper || !item.forms.length || item.count < 1) throw Error(`Invalid exam occurrence: ${word}`);
    return {source: evidence.source, url: paper.url, listUrl: evidence.indexUrl, version: paper.id};
  });
  return {
    id: `${prefix}${word}-${pos.replace('.', '')}-1`, word, pos, meaning, collocation,
    example, translation, test, testTranslation, phonetic: record.phonetic,
    tags: ['CET6'], source: evidence.source, version: references[0].version,
    sourceUrl: references[0].url, references, scene: group.id,
    mnemonic: `想象「${group.title}」中的这一步：${meaning}。把 ${word} 与 ${collocation} 一起记住。`,
    materialStatus: 'complete',
  };
});
if (added.length !== 150 || added.length !== groups.size || added.some(word => word.example === word.test)) throw Error('Expected 150 complete CET6 additions.');
catalog.words = [...retained, ...added];
catalog.scenes = [...catalog.scenes.filter(scene => !scene.id.startsWith(prefix)), ...scenes];
catalog.cet6ExamExpansion = {
  authoredAt: expansion.authoredAt, entries: added.length, samplePapers: papers.size,
  selection: expansion.selection, materials: expansion.materials,
};
fs.writeFileSync('content/catalog.json', JSON.stringify(catalog, null, 2) + '\n');
console.log(JSON.stringify({cet6ExamAdded: added.length, total: catalog.words.length, cet6: catalog.words.filter(word => word.tags.includes('CET6')).length}));
