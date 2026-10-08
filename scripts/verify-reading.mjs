import assert from 'node:assert/strict';
import { build } from 'esbuild';

await build({ entryPoints: ['lib/reading.ts', 'lib/learning.ts', 'lib/validation.ts', 'lib/curriculum.ts'], outdir: '.sites-runtime/reading-tests', bundle: true, platform: 'node', format: 'esm' });
const { readingSummary, completeReading, validatePassage, passageParts } = await import('../.sites-runtime/reading-tests/reading.js');
const { initialState, allWords, applyAction, seedWords } = await import('../.sites-runtime/reading-tests/learning.js');
const { stateSchema, actionSchema } = await import('../.sites-runtime/reading-tests/validation.js');
const { readingPassages, coursePassages, nextReading } = await import('../.sites-runtime/reading-tests/curriculum.js');
const now = Date.now();
const byId = new Map(seedWords.map(word => [word.id, word]));

assert.equal(readingPassages.length, 61);
assert.equal(new Set(readingPassages.map(p => p.id)).size, 61);
assert.equal(new Set(readingPassages.map(p => p.title)).size, 61);
assert.equal(new Set(readingPassages.flatMap(p => p.wordIds)).size, seedWords.length);
for (const passage of readingPassages) {
  assert.ok(passage.wordIds.length >= 20 && passage.wordIds.length <= 40);
  assert.equal(new Set(passage.wordIds).size, passage.wordIds.length);
  const targets = passage.wordIds.map(id => byId.get(id));
  assert.ok(targets.every(word => word && word.tags.includes(passage.level)));
  validatePassage(passage, targets);
  assert.deepEqual(new Set(passageParts(passage.text).filter(p => p.type === 'word').map(p => p.id)), new Set(passage.wordIds));
}

for (const level of ['CET4', 'CET6']) {
  const state = initialState(); state.settings.level = level; state.settings.daily = 1;
  // Old flashcard quotas and scores cannot prevent traversing the entire reading course.
  state.learned = Object.fromEntries(allWords(state).map(word => [word.id, now]));
  const beforeLearned = structuredClone(state.learned);
  const course = coursePassages(state); const visited = new Set();
  for (let index = 0; index < course.length; index++) {
    const passage = nextReading(state);
    assert.equal(passage.id, course[index].id);
    assert.ok(!visited.has(passage.id)); visited.add(passage.id);
    const covered = readingSummary(state).covered;
    completeReading(state, passage, now + index);
    assert.ok(readingSummary(state).covered > covered);
  }
  assert.equal(readingSummary(state).covered, seedWords.filter(word => word.tags.includes(level)).length);
  assert.deepEqual(state.learned, beforeLearned);
  assert.deepEqual(state.events, []); assert.deepEqual(state.progress, {});
  assert.equal(nextReading(state, course.at(-1).id).id, course[0].id, 'A completed course loops for rereading');
  assert.equal(nextReading(state).id, course[0].id);
  console.log(`PASS: ${level}, ${course.length} authored paragraphs, all ${readingSummary(state).total} senses covered without changing test scores.`);
}

const state = initialState(); const first = nextReading(state);
let progress = applyAction(state, { type: 'reading-complete', passage: first, operationId: 'reading-a' }, now);
progress = applyAction(progress, { type: 'reading-complete', passage: first, operationId: 'reading-b' }, now + 1);
assert.equal(progress.reading.encounters[first.wordIds[0]].count, 1);
assert.equal(Object.keys(progress.learned).length, 0);
assert.deepEqual(stateSchema.parse(JSON.parse(JSON.stringify(progress))).reading, progress.reading);
assert.equal(nextReading(progress).id, coursePassages(progress)[1].id);
assert.equal(nextReading(initialState(), first.id).id, coursePassages(progress)[1].id);
const legacy = initialState(); delete legacy.reading; legacy.settings.count = 6; legacy.settings.daily = 6;
assert.ok(stateSchema.safeParse(legacy).success);
assert.equal(nextReading(legacy).id, first.id);
assert.equal(actionSchema.safeParse({ type: 'reading-complete', passage: first, operationId: 'untrusted' }).success, false);
const targets = first.wordIds.map(id => byId.get(id));
assert.throws(() => validatePassage({ ...first, text: first.text.replaceAll(`[[${targets[0].id}]]`, '') }, targets), /覆盖/);
assert.throws(() => validatePassage({ ...first, text: first.text + '[[invented]]' }, targets), /覆盖/);
assert.throws(() => validatePassage({ ...first, text: first.wordIds.map(id => `[[${id}]]`).join(',') }, targets), /上下文/);
const invalid = structuredClone(progress); invalid.reading.encounters.unknown = {count:1,last:now};
assert.ok(!stateSchema.safeParse(invalid).success);
const imported = { ...seedWords[0], id: 'imported_word', word: 'customword', tags: ['CET6'] };
progress.custom.push(imported);
assert.equal(readingSummary(progress).total, 2128, 'Imported words do not falsely expand the built-in course');
assert.equal(seedWords.find(w => w.word === 'sheriff').meaning.includes('县警长'), true);
assert.equal(seedWords.find(w => w.word === 'arc').meaning.includes('弧线'), true);
console.log('PASS: 61 real paragraphs, exact targets, full 2163-sense coverage, resume/loop, completion deduplication, backup roundtrip, old backups, untrusted completion rejection and dictionary corrections.');
