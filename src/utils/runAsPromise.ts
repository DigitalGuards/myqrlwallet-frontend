/**
 * Runs `body` now and returns its outcome as a promise, with the contract of
 * an async function whose body never awaits: the body runs synchronously at
 * call time, its return value resolves the promise (a returned promise is
 * adopted) and a throw rejects it with the thrown value.
 *
 * Use it where a function must keep returning a promise after lint removes
 * an `async` keyword that had no `await` to justify it.
 */
export const runAsPromise = <T>(body: () => T | PromiseLike<T>): Promise<T> =>
  new Promise<T>((resolve) => {
    resolve(body());
  });
