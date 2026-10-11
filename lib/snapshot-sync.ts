// Keep the validator and revision together, including across account changes.
export function createSnapshotSync(initialRevision: number, initialEtag: string) {
  let epoch = 0;
  let revision = initialRevision;
  let etag = initialEtag;
  return {
    get epoch() { return epoch; },
    get revision() { return revision; },
    get etag() { return etag; },
    beginSession(nextRevision = -1) {
      epoch++;
      revision = nextRevision;
      etag = '';
    },
    accept(requestEpoch: number, nextRevision: number, nextEtag: string | null) {
      if (requestEpoch !== epoch || nextRevision < revision) return null;
      const changed = nextRevision > revision;
      revision = nextRevision;
      etag = nextEtag ?? '';
      return { changed };
    },
    unchanged(requestEpoch: number, requestedEtag: string) {
      return requestEpoch === epoch && !!requestedEtag && requestedEtag === etag;
    },
  };
}
