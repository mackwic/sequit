/* eslint-disable no-console -- the room journal's console sink is replaced for the test isolate. */
/**
 * The room journal writes to the console from socket-close and alarm handlers that outlive a
 * test; forwarding those lines to the host reporter races its teardown. Plain assignments survive
 * `vi.restoreAllMocks()`; tests that assert on the journal spy on these same methods.
 */
const silent = (): void => undefined;
console.info = silent;
console.warn = silent;
console.error = silent;
