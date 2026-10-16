/** A controllable promise for checking effects before and after completion. */
export function deferred<T>() {
  const controls: {
    resolve?: (value: T | PromiseLike<T>) => void;
    reject?: (reason?: unknown) => void;
  } = {};
  const promise = new Promise<T>((resolve, reject) => {
    controls.resolve = resolve;
    controls.reject = reject;
  });
  if (!controls.resolve || !controls.reject) {
    throw new Error("Promise controls were not initialized");
  }
  return { promise, resolve: controls.resolve, reject: controls.reject };
}
