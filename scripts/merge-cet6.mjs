import fs from 'node:fs';
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const index = read('content/sources/koolearn-cet6-index.json');
const details = read('content/sources/koolearn-cet6-details.json');
const catalog = read('content/catalog.json');
// These source pages present name metadata before their dictionary definitions.
const corrected = {
  scarlet: ['n.', '猩红色；鲜红色', 'ˈskɑ:lət'],
  jean: ['n.', '牛仔布；牛仔裤（常用复数）', 'dʒi:n'],
  Jesus: ['n.', '耶稣', 'ˈdʒi:zəs'],
  baron: ['n.', '男爵；大亨', 'ˈbærən'],
  Roman: ['n.', '古罗马人；罗马人', 'ˈrəumən'],
  Venus: ['n.', '金星；维纳斯', 'ˈviːnəs'],
  Mars: ['n.', '火星；战神马尔斯', 'mɑ:z'],
  should: ['aux.', '应该；应当', 'ʃʊd'],
  calculus: ['n.', '微积分；运算', 'ˈkælkjələs'],
  tack: ['n.', '大头钉；方针，方法；航向', 'tæk'],
  impress: ['v.', '给…留下深刻印象；使铭记', 'ɪmˈpres'],
  whereas: ['conj.', '然而；但是；而（表示对比）', 'ˌweərˈæz'],
  Mercury: ['n.', '水星；汞，水银', 'ˈmɜ:kjəri'],
};
const byWord = new Map(details.map(word => [word.word.toLowerCase(), word]));
for (const [word, [pos, meaning, phonetic]] of Object.entries(corrected)) {
  const entry = index.entries.find(entry => entry.word === word);
  if (!entry) throw Error('Missing source for ' + word);
  byWord.set(word.toLowerCase(), {...byWord.get(word.toLowerCase()), ...entry, spelling: word, pos, meaning, phonetic, reviewedAt: '2026-10-07', reviewNote: '释义根据原页英英释义、双语释义及例句校正；未采用人名元数据。'});
}
const words = catalog.words.filter(word => !word.id.startsWith('koolearn-'));
const existing = new Map(words.map(word => [word.word.toLowerCase(), word]));
const normalize = pos => /^v[ti]?\.|^vt\.&/.test(pos) ? 'v.' : pos === 'int.' ? 'interj.' : pos;
for (const entry of index.entries) {
  const detail = byWord.get(entry.word.toLowerCase());
  if (!detail?.meaning) throw Error('Missing definition: ' + entry.word);
  const reference = {source: '新东方在线 · 六级必备', url: entry.url, listUrl: entry.listUrl, version: '2026-10-06'};
  const match = existing.get(entry.word.toLowerCase());
  if (match) {
    match.tags = [...new Set([...match.tags, 'CET6'])];
    match.references = [...(match.references ?? []).filter(ref => ref.source !== reference.source), reference];
    match.materialStatus = 'complete';
    continue;
  }
  words.push({id: 'koolearn-' + entry.word.toLowerCase(), word: entry.word, pos: normalize(detail.pos), meaning: detail.meaning.replace(/^(?:n\.\s*|&\s*vi\.\s*)/, ''),
    collocation: '', example: '', translation: '', test: '', testTranslation: '', phonetic: detail.phonetic,
    tags: ['CET6'], source: reference.source, version: reference.version, sourceUrl: entry.url,
    scene: '', mnemonic: '', materialStatus: 'basic', references: [reference]});
}
catalog.words = words;
catalog.cet6Source = {title: index.title, version: '2026-10-06', entries: index.entries.length, pages: index.pages.length, reviewedAt: '2026-10-07'};
fs.writeFileSync('content/catalog.json', JSON.stringify(catalog, null, 2) + '\n');
fs.writeFileSync('content/sources/koolearn-cet6-details.json', JSON.stringify([...byWord.values()], null, 2) + '\n');
fs.writeFileSync('content/sources/koolearn-cet6-errors.json', '[]\n');
console.log(JSON.stringify({sourceWords: index.entries.length, total: words.length, cet6: words.filter(w => w.tags.includes('CET6')).length, complete: words.filter(w => w.materialStatus !== 'basic').length}));
