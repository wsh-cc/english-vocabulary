import fs from 'node:fs';

const read = path => JSON.parse(fs.readFileSync(path, 'utf8'));
const catalog = read('content/catalog.json');
const expansion = read('content/cet4-expansion.json');
const source = read('content/sources/version.json');
const sourceLines = fs.readFileSync('content/sources/CET4_edited.txt', 'utf8').split(/\r?\n/);
const rows = fs.readFileSync('content/cet4-expansion.tsv', 'utf8').trim().split(/\r?\n/);
const prefix = 'cet4-common-';
const retained = catalog.words.filter(word => !word.id.startsWith(prefix));
const spellings = new Set(retained.map(word => word.word.toLowerCase()));
const bySpelling = new Map();
const scenes = expansion.groups.map(group => {
  if (!group.id.startsWith(prefix)) throw Error(`Invalid expansion group: ${group.id}`);
  const words = group.words.split(' ');
  for (const word of words) {
    if (bySpelling.has(word)) throw Error(`Word appears in multiple groups: ${word}`);
    bySpelling.set(word, group);
  }
  return {id: group.id, title: group.title, category: group.category, text: group.text, words};
});
// The source lists noun-first or shared pronunciations for these spellings.
const phonetics = {record: 'rɪˈkɔːd', transport: 'ˈtrænspɔːt'};
const added = rows.map((line, index) => {
  const fields = line.split('|');
  if (fields.length !== 8 || fields.some(field => !field.trim())) throw Error(`Incomplete CET4 row ${index + 1}`);
  const [word, pos, meaning, collocation, example, translation, test, testTranslation] = fields;
  if (spellings.has(word.toLowerCase())) throw Error(`Duplicate spelling in CET4 expansion: ${word}`);
  spellings.add(word.toLowerCase());
  const sourceLine = sourceLines.find(entry => entry.startsWith(word + ' '));
  const group = bySpelling.get(word);
  const phonetic = phonetics[word] ?? sourceLine?.match(/\[([^\]]+)\]/)?.[1];
  if (!sourceLine || !phonetic || !group || example === test) throw Error(`Unverified or incomplete CET4 word: ${word}`);
  return {
    id: `${prefix}${word}-${pos.replace('.', '')}-1`, word, pos, meaning, collocation,
    example, translation, test, testTranslation, phonetic, tags: ['CET4'],
    source: 'mahavivo/english-wordlists', version: source.sha,
    sourceUrl: `${source.repository}/tree/${source.sha}`,
    sourceEntries: [{tag: 'CET4', line: sourceLine}], scene: group.id,
    mnemonic: `想象「${group.title}」中的这一步：${meaning}。把 ${word} 与 ${collocation} 一起记住。`,
    materialStatus: 'complete',
  };
});
if (added.length !== bySpelling.size || [...bySpelling.keys()].some(word => !added.some(entry => entry.word === word))) {
  throw Error('CET4 words and reading groups must match exactly.');
}
catalog.words = [...retained, ...added];
catalog.scenes = [...catalog.scenes.filter(scene => !scene.id.startsWith(prefix)), ...scenes];
catalog.cet4Expansion = {authoredAt: expansion.authoredAt, entries: added.length, selection: expansion.selection, materials: expansion.materials};
fs.writeFileSync('content/catalog.json', JSON.stringify(catalog, null, 2) + '\n');
console.log(JSON.stringify({added: added.length, total: catalog.words.length, cet4: catalog.words.filter(word => word.tags.includes('CET4')).length}));
