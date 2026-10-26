import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHash } from 'node:crypto';

const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const catalog = read('content/catalog.json');
const readings = read('content/readings.json');
const expansion = read('content/cet6-exam-expansion.json');
const evidence = read('content/sources/cet6-exam-evidence.json');
const added = catalog.words.filter(word => word.id.startsWith('cet6-exam-'));
const oldWords = catalog.words.filter(word => !word.id.startsWith('cet6-exam-'));
const oldSpellings = new Set(oldWords.map(word => word.word.toLowerCase()));
assert.equal(oldWords.length, 2463);
assert.equal(added.length, 150);
assert.equal(catalog.words.length, 2613);
assert.equal(catalog.words.filter(word => word.tags.includes('CET6')).length, 2278);
assert.equal(catalog.words.filter(word => word.tags.includes('CET4')).length, 389);
assert.equal(new Set(added.map(word => word.word.toLowerCase())).size, 150);
assert.equal(new Set(added.flatMap(word => [word.example, word.test]).map(text => text.toLowerCase().replace(/[^a-z0-9]+/g, ' '))).size, 300);
assert.equal(evidence.papers.length, 15);
assert.equal(new Set(evidence.papers.map(paper => paper.id)).size, 15);
const papers = new Map(evidence.papers.map(paper => [paper.id, paper]));
for (const paper of papers.values()) {
  assert.match(paper.url, /^https:\/\/eol\.nju\.edu\.cn\/cet6\/papers\/\d{6}-[123]\.html$/);
  assert.match(paper.sha256, /^[a-f0-9]{64}$/);
  assert.deepEqual(paper.sectionIds, ['listening', 'banked', 'matching', 'careful']);
}
for (const word of added) {
  assert.ok(!oldSpellings.has(word.word.toLowerCase()), word.word + ' repeats an existing spelling');
  assert.deepEqual(word.tags, ['CET6']);
  assert.equal(word.materialStatus, 'complete');
  assert.ok(word.phonetic && word.collocation && word.example !== word.test);
  for (const field of ['meaning', 'translation', 'testTranslation']) assert.match(word[field], /[\u3400-\u9fff]/);
  for (const field of ['example', 'test']) assert.ok(word[field].toLowerCase().includes(word.word), `${word.word}: missing target in ${field}`);
  const entry = evidence.entries.find(entry => entry.word === word.word);
  assert.ok(entry && entry.evidence.length >= 2, word.word + ' lacks sampled-paper evidence');
  assert.equal(entry.papers, entry.evidence.length);
  assert.equal(entry.count, entry.evidence.reduce((sum, item) => sum + item.count, 0));
  assert.equal(word.references.length, entry.papers);
  assert.ok(catalog.scenes.find(scene => scene.id === word.scene)?.words.includes(word.word));
  for (const occurrence of entry.evidence) {
    assert.ok(papers.has(occurrence.paper));
    assert.ok(occurrence.forms.length && occurrence.count > 0);
    const cached = `.sites-runtime/cet6-research/${occurrence.paper}.txt`;
    if (fs.existsSync(cached)) {
      const tokens = fs.readFileSync(cached, 'utf8').toLowerCase().match(/[a-z]+(?:'[a-z]+)?/g) ?? [];
      assert.equal(occurrence.count, tokens.filter(token => occurrence.forms.includes(token)).length, word.word + ' has an incorrect occurrence count');
    }
  }
}
assert.equal(expansion.groups.length, 6);
for (const group of expansion.groups) {
  assert.equal(group.words.split(' ').length, 25);
  const passage = readings.passages.find(passage => passage.batch === group.id);
  assert.ok(passage && passage.level === 'CET6' && passage.wordIds.length === 25);
  assert.ok(passage.wordIds.every(id => added.some(word => word.id === id)));
}
assert.equal(readings.passages.filter(passage => !passage.batch.startsWith('cet6-exam-')).length, 71);
// This run's captured content hashes ensure existing IDs and materials were not rewritten.
if (fs.existsSync('.sites-runtime/cet6-baseline.json')) {
  const baseline = read('.sites-runtime/cet6-baseline.json');
  for (const [values, hashes] of [[catalog.words, baseline.wordHashes], [readings.passages, baseline.readingHashes]]) {
    for (const [id, hash] of Object.entries(hashes)) {
      const value = values.find(value => value.id === id);
      assert.ok(value, 'Missing legacy id: ' + id);
      assert.equal(createHash('sha256').update(JSON.stringify(value)).digest('hex'), hash, 'Changed legacy content: ' + id);
    }
  }
}
console.log('PASS: 150 new CET6 spellings, 300 original bilingual examples, 6 complete readings, evidence from 15 sampled papers, legacy content and IDs preserved.');
