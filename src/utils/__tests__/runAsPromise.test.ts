import { runAsPromise } from "../runAsPromise";

type IsExactly<A, B> = [A] extends [B]
  ? [B] extends [A]
    ? true
    : false
  : false;

describe("runAsPromise", () => {
  it("runs the body synchronously at call time", () => {
    const calls: string[] = [];
    const result = runAsPromise(() => {
      calls.push("body");
      return 1;
    });
    calls.push("after call");
    expect(calls).toEqual(["body", "after call"]);
    return expect(result).resolves.toBe(1);
  });

  it("resolves with the returned value", async () => {
    await expect(runAsPromise(() => ({ value: 2 }))).resolves.toEqual({
      value: 2,
    });
    await expect(runAsPromise(() => undefined)).resolves.toBeUndefined();
  });

  it("rejects with the exact thrown value", async () => {
    const error = new Error("storage failed");
    await expect(
      runAsPromise(() => {
        throw error;
      }),
    ).rejects.toBe(error);
  });

  it("does not throw synchronously when the body throws", () => {
    let result: Promise<never> | undefined;
    expect(() => {
      result = runAsPromise(() => {
        throw new Error("late");
      });
    }).not.toThrow();
    return expect(result).rejects.toThrow("late");
  });

  it("types a nested thenable result as its settled value", () => {
    const exact: IsExactly<
      ReturnType<typeof runAsPromise<PromiseLike<Promise<number>>>>,
      Promise<number>
    > = true;
    expect(exact).toBe(true);
  });

  it("settles on the same microtask as an async function would", async () => {
    // An async function resolves a plain value at once and adopts a returned
    // promise two microtasks later. A shortcut such as Promise.resolve(body())
    // would settle the adopted case first and break callers' ordering.
    const order: string[] = [];
    void runAsPromise(() => "plain").then(() => {
      order.push("plain");
    });
    void runAsPromise(() => Promise.resolve("adopted")).then(() => {
      order.push("adopted");
    });
    void Promise.resolve()
      .then(() => {
        order.push("tick 1");
      })
      .then(() => {
        order.push("tick 2");
      })
      .then(() => {
        order.push("tick 3");
      });
    await new Promise((resolve) => {
      setTimeout(resolve, 0);
    });
    expect(order).toEqual(["plain", "tick 1", "tick 2", "adopted", "tick 3"]);
  });

  it("adopts a returned promise", async () => {
    await expect(runAsPromise(() => Promise.resolve("inner"))).resolves.toBe(
      "inner",
    );
    const inner = new Error("inner failed");
    await expect(runAsPromise(() => Promise.reject(inner))).rejects.toBe(inner);
  });
});
