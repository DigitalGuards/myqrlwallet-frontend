/**
 * Runs `body` now and returns its outcome as a promise, with the contract of
 * an async function whose body never awaits: the body runs synchronously at
 * call time, its return value resolves the promise (a returned promise or
 * thenable is adopted, as many levels deep as it nests) and a throw rejects
 * it with the thrown value.
 *
 * Use it where a function must keep returning a promise after lint removes
 * an `async` keyword that had no `await` to justify it. The result type is
 * `Awaited`, the type an async function returning the same value would have.
 */
export function runAsPromise<T>(body: () => T): Promise<Awaited<T>>;
export function runAsPromise(body: () => unknown): Promise<unknown> {
  return new Promise((resolve) => {
    resolve(body());
  });
}
