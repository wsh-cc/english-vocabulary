// Share the same module request between an intent preload and React.lazy.
// Only code is cached here; learner snapshots remain scoped to their session.
export function createLazyModule<T>(importModule: () => Promise<T>) {
  let request: Promise<T> | undefined;
  const load = () => {
    request ??= importModule().catch(error => {
      request = undefined;
      throw error;
    });
    return request;
  };
  return {
    load,
    // A speculative failure must not become an unhandled rejection or prevent
    // the real navigation from trying again and showing its error boundary.
    preload: () => { void load().catch(() => {}); },
  };
}
