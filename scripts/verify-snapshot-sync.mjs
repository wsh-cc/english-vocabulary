import assert from 'node:assert/strict';
import { build } from 'esbuild';

// Tests the real pure tracker. No HTTP requests, credentials or learner storage.
const bundled = await build({
  entryPoints: ['lib/snapshot-sync.ts'],
  bundle: true, platform: 'node', format: 'esm', write: false,
});
const { createSnapshotSync } = await import('data:text/javascript;base64,' + Buffer.from(bundled.outputFiles[0].text).toString('base64'));

// A GET starts at revision 10; a save completes before the old GET response.
const sync = createSnapshotSync(10, '"account-a-10"');
const getEpoch = sync.epoch;
const getTag = sync.etag;
assert.equal(sync.revision, 10);
assert.deepEqual(sync.accept(getEpoch, 11, '"account-a-11"'), { changed: true });
assert.equal(sync.accept(getEpoch, 10, getTag), null, 'An old GET cannot replace the newer saved snapshot.');
assert.equal(sync.revision, 11);
assert.equal(sync.etag, '"account-a-11"', 'Rejecting an old snapshot must also preserve the newer ETag.');
assert.equal(sync.unchanged(getEpoch, getTag), false, 'An old 304 cannot count as synchronization of the current revision.');
assert.equal(sync.unchanged(getEpoch, sync.etag), true);

// A newer cross-device GET arrives before a slower save response.
assert.deepEqual(sync.accept(getEpoch, 13, '"account-a-13"'), { changed: true });
assert.equal(sync.accept(getEpoch, 12, '"account-a-12"'), null);
assert.equal(sync.revision, 13);
assert.equal(sync.etag, '"account-a-13"');

// An idempotent retry refreshes a validator without asking to rewrite state.
assert.deepEqual(sync.accept(getEpoch, 13, '"account-a-13-revalidated"'), { changed: false });
assert.equal(sync.revision, 13);
assert.equal(sync.etag, '"account-a-13-revalidated"');
assert.equal(sync.unchanged(getEpoch, '"account-a-13"'), false);
assert.equal(sync.unchanged(getEpoch, sync.etag), true);

// Old-server/missing-header compatibility must not attach a stale ETag to new state.
assert.deepEqual(sync.accept(getEpoch, 14, ''), { changed: true });
assert.equal(sync.etag, '', 'A newer snapshot without a validator clears the previous validator.');
assert.equal(sync.unchanged(getEpoch, ''), false, 'An empty request validator never validates synchronization.');
assert.equal(sync.unchanged(getEpoch, '"account-a-13-revalidated"'), false);
assert.deepEqual(sync.accept(getEpoch, 14, '"account-a-14"'), { changed: false });
assert.deepEqual(sync.accept(getEpoch, 14, ''), { changed: false });
assert.equal(sync.etag, '', 'Equal-revision snapshots without a validator must also clear it.');

// GET, ordinary save and reading completion retain the epoch from request start.
const staleGetEpoch = sync.epoch;
const staleSaveEpoch = sync.epoch;
const staleReadingEpoch = sync.epoch;
sync.beginSession();
assert.equal(sync.epoch, staleGetEpoch + 1);
assert.equal(sync.revision, -1);
assert.equal(sync.etag, '');
assert.equal(sync.accept(staleGetEpoch, 15, '"account-a-15"'), null);
assert.equal(sync.accept(staleSaveEpoch, 16, '"account-a-16"'), null, 'A saved snapshot cannot cross logout/session change.');
assert.equal(sync.accept(staleReadingEpoch, 17, '"account-a-17"'), null, 'Reading completion cannot cross logout/session change.');
assert.equal(sync.revision, -1);
assert.equal(sync.etag, '');

// Revision zero is valid for a new account and cannot be suppressed by old revisions.
const newEpoch = sync.epoch;
assert.deepEqual(sync.accept(newEpoch, 0, '"account-b-0"'), { changed: true });
assert.equal(sync.revision, 0);
assert.equal(sync.etag, '"account-b-0"');
assert.equal(sync.unchanged(staleGetEpoch, '"account-b-0"'), false, 'Even a matching ETag cannot validate the wrong epoch.');
assert.equal(sync.unchanged(newEpoch, '"account-b-0"'), true);
assert.deepEqual(sync.accept(newEpoch, 0, '"account-b-0"'), { changed: false });

// Explicit resets used for sign-out clear validators and advance the same guard.
sync.beginSession(0);
assert.equal(sync.epoch, newEpoch + 1);
assert.equal(sync.revision, 0);
assert.equal(sync.etag, '');
assert.equal(sync.accept(newEpoch, 100, '"account-b-100"'), null);
assert.equal(sync.unchanged(sync.epoch, ''), false);

console.log('PASS: real snapshot tracker; old GET/save ordering, stale 304, idempotent revisions, missing validators, logout/reading epoch isolation and new-account revision zero. No network or learner data.');
