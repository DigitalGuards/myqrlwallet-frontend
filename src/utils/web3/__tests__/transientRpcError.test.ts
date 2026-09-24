/**
 * The name()/symbol() negative cache is only allowed to hold answers the
 * node actually gave. isTransientRpcError draws that line: a revert or
 * undecodable return is an answer, a dead socket is not.
 */
// nft.ts pulls SERVER_URL from the Vite-only config barrel; the
// classifier under test needs none of it.
jest.mock("@/config", () => ({ SERVER_URL: "https://wallet.example" }));

import { isTransientRpcError } from "../nft";

describe("isTransientRpcError", () => {
  it("flags transport failures", () => {
    const transient: unknown[] = [
      new TypeError("Failed to fetch"),
      new Error("fetch failed"),
      new Error("connect ECONNREFUSED 127.0.0.1:8545"),
      new Error("socket hang up"),
      new Error("Request timed out"),
      new Error("Invalid JSON RPC response: \"\""),
      new Error("Bad Gateway"),
      new Error("The operation was aborted"),
      { code: "ETIMEDOUT" },
      { name: "ConnectionError", message: "connection refused" },
      "network error",
    ];
    for (const error of transient) {
      expect(isTransientRpcError(error)).toBe(true);
    }
  });

  it("treats contract-level failures as definitive answers", () => {
    const definitive: unknown[] = [
      new Error("execution reverted"),
      new Error(
        "Returned values aren't valid, did it run Out of Gas? Contract address is not a contract.",
      ),
      new Error("Parameter decoding error"),
      { name: "ContractExecutionError", message: "revert" },
      undefined,
      null,
      42,
    ];
    for (const error of definitive) {
      expect(isTransientRpcError(error)).toBe(false);
    }
  });

  it("unwraps a transport failure nested under cause or innerError", () => {
    const wrapped = Object.assign(new Error("Web3 call failed"), {
      innerError: Object.assign(new Error("request failed"), {
        cause: new Error("ECONNRESET"),
      }),
    });
    expect(isTransientRpcError(wrapped)).toBe(true);
    expect(
      isTransientRpcError(
        Object.assign(new Error("Response error"), { statusCode: 503 }),
      ),
    ).toBe(true);
    expect(
      isTransientRpcError(
        Object.assign(new Error("Response error"), { statusCode: 404 }),
      ),
    ).toBe(false);
  });

  it("does not loop on a self-referencing cause chain", () => {
    const loop: { message: string; cause?: unknown } = {
      message: "execution reverted",
    };
    loop.cause = loop;
    expect(isTransientRpcError(loop)).toBe(false);
  });
});
