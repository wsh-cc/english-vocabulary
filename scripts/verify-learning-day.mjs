import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { build } from 'esbuild';

await mkdir('.sites-runtime', { recursive: true });
await build({
  stdin: {
    contents: "export { beijingDayBounds } from './app/learning-day'; export { chinaDay, DAY } from './lib/learning';",
    resolveDir: process.cwd(),
    sourcefile: 'learning-day-verification.ts',
    loader: 'ts',
  },
  bundle: true,
  platform: 'node',
  format: 'esm',
  outfile: '.sites-runtime/learning-day-verification.mjs',
});
const { beijingDayBounds, chinaDay, DAY } = await import('../.sites-runtime/learning-day-verification.mjs');

// Compare the production helper with the previous per-record Beijing date
// conversion, including exact millisecond boundaries. Fixtures are synthetic.
const snapshots = [
  '1970-01-01T00:00:00.000Z',
  '2026-10-10T15:59:59.999Z',
  '2026-10-10T16:00:00.000Z',
  '2026-10-11T15:59:59.999Z',
  '2026-10-11T16:00:00.000Z',
  '2026-12-31T15:59:59.999Z',
  '2026-12-31T16:00:00.000Z',
  '2024-02-28T16:00:00.000Z',
  '2024-02-29T16:00:00.000Z',
];
let comparisons = 0;
for (const text of snapshots) {
  const day = chinaDay(Date.parse(text));
  const [start, end] = beijingDayBounds(day);
  assert.equal(end - start, DAY);
  assert.equal(chinaDay(start), day);
  assert.equal(chinaDay(end - 1), day);
  assert.notEqual(chinaDay(start - 1), day);
  assert.notEqual(chinaDay(end), day);
  for (const at of [start - DAY, start - 1, start, start + 1, end - 1, end, end + 1]) {
    assert.equal(at >= start && at < end, chinaDay(at) === day);
    comparisons++;
  }
  for (const count of [0, 1000, 10000]) {
    const timestamps = Array.from({ length: count }, (_, index) => Math.max(0, start + ((index % 17) - 8) * 6 * 3600000 + index % 3));
    const previous = timestamps.filter(at => chinaDay(at) === day).length;
    const current = timestamps.filter(at => at >= start && at < end).length;
    assert.equal(current, previous, `${text}: ${count} synthetic timestamps`);
    // The same window feeds today's events, completed passages and learned
    // quota. Verify the quota subtraction remains identical for each setting.
    for (const daily of [1, 6, 10, 20, 40]) {
      assert.equal(Math.max(0, daily - current), Math.max(0, daily - previous));
    }
    comparisons++;
  }
}
console.log(`PASS: production Beijing-day bounds; midnight, year rollover, leap day; 0/1000/10000 synthetic timestamp counts and quotas (${comparisons} comparisons).`);
