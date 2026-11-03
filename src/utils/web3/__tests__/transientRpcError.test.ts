/**
 * The name()/symbol() negative cache is only allowed to hold answers the
 * node actually gave. isTransientRpcError draws that line: a revert or
 * undecodable return is an answer, a dead socket is not.
 */
// nft.ts pulls SERVER_URL from the Vite-only config barrel; the
// classifier under test needs none of it.
jest.mock("@/config", () => ({ SERVER_URL: "https://wallet.example" }));

import { createServer } from "node:http";
import { ERR_INVALID_RESPONSE, InvalidResponseError } from "@theqrl/web3";
import { fetchCollectionNameSymbol, isTransientRpcError } from "../nft";

describe("isTransientRpcError", () => {
  it("flags transport failures", () => {
    const transient: unknown[] = [
      new TypeError("Failed to fetch"),
      new Error("fetch failed"),
      new Error("connect ECONNREFUSED 127.0.0.1:8545"),
      new Error("socket hang up"),
      new Error("Request timed out"),
      new Error("Invalid JSON RPC response: \"\""),
      // The same check in @theqrl/web3 2.0.0 wording, with the hyphen.
      new Error("Invalid JSON-RPC response: qrl_call returned 123, expected hex encoded bytes at result"),
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

  it("flags an InvalidResponseError that carries no error from the node", () => {
    // Since @theqrl/web3 2.0.0 the client raises InvalidResponseError about a
    // reply it will not trust, with no inner error or with its own code there.
    // The messages below carry neither check's prefix, so only that test can
    // tell them apart from the node's own error, which stays an answer.
    const noInnerError = new InvalidResponseError({ jsonrpc: "2.0", id: 1, result: "0x" });
    expect(noInnerError.message).toBe("Returned error: ");
    expect(isTransientRpcError(noInnerError)).toBe(true);
    expect(
      isTransientRpcError(
        new InvalidResponseError({
          jsonrpc: "2.0",
          id: 1,
          error: { code: ERR_INVALID_RESPONSE, message: "checked by the client" },
        }),
      ),
    ).toBe(true);
    expect(
      isTransientRpcError(
        new InvalidResponseError({
          jsonrpc: "2.0",
          id: 1,
          error: { code: -32000, message: "invalid opcode: INVALID" },
        }),
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

/**
 * Driven through the real client and a real HttpProvider, because the class
 * and fields of a transport error are web3's choice. Since @theqrl/web3 2.0.0
 * a non-2xx reply is an HttpStatusError carrying `status`, so a gateway error
 * is recognised as transient. 1.0.3 raised a bare ResponseError with neither
 * a status nor a telling message, and a 502 was cached as "this contract has
 * no name".
 */
describe("fetchCollectionNameSymbol through a real HttpProvider", () => {
  type Reply = { status: number; contentType: string; body: (id: unknown) => string };

  async function readNameSymbolAnswering(reply: Reply) {
    const server = createServer((req, res) => {
      let body = "";
      req.setEncoding("utf8");
      req.on("data", (chunk: unknown) => {
        if (typeof chunk === "string") body += chunk;
      });
      req.on("end", () => {
        let id: unknown = null;
        try {
          const parsed: unknown = JSON.parse(body);
          if (typeof parsed === "object" && parsed !== null && "id" in parsed) id = parsed.id;
        } catch {
          // An unparseable request gets the scripted reply all the same.
        }
        res.writeHead(reply.status, { "content-type": reply.contentType });
        res.end(reply.body(id));
      });
    });
    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", resolve);
    });
    try {
      const address = server.address();
      if (typeof address !== "object" || address === null) throw new Error("no TCP port");
      return await fetchCollectionNameSymbol(`Q${"3".repeat(128)}`, `http://127.0.0.1:${address.port}`);
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve) => {
        server.close(() => {
          resolve();
        });
      });
    }
  }

  it.each([
    ["a 502 HTML page", 502, "text/html"],
    ["a 503 JSON error", 503, "application/json"],
    ["a 500 with no body", 500, "text/plain"],
  ])("keeps %s out of the negative cache", async (_label, status, contentType) => {
    const result = await readNameSymbolAnswering({
      status,
      contentType,
      body: (id) =>
        contentType === "application/json"
          ? JSON.stringify({ jsonrpc: "2.0", id, error: { code: -32000, message: "unavailable" } })
          : contentType === "text/html"
            ? "<html><body>Bad gateway</body></html>"
            : "",
    });
    expect(result).toEqual({ name: undefined, symbol: undefined, definitive: false });
  });

  // Since 2.0.0 the client checks the reply before it trusts it and raises
  // InvalidResponseError when a check fails. Under 1.0.3 the first was a
  // ResponseError, recognised as transient, and the other two resolved.
  it.each([
    ["a reply with neither result nor error", (id: unknown) => JSON.stringify({ jsonrpc: "2.0", id })],
    [
      "a reply carrying another request's id",
      () => JSON.stringify({ jsonrpc: "2.0", id: "another-request", result: "0x" }),
    ],
    ["a qrl_call result that is not hex bytes", (id: unknown) => JSON.stringify({ jsonrpc: "2.0", id, result: 123 })],
  ])("keeps %s out of the negative cache", async (_label, body) => {
    const result = await readNameSymbolAnswering({ status: 200, contentType: "application/json", body });
    expect(result).toEqual({ name: undefined, symbol: undefined, definitive: false });
  });

  it("caches a contract whose reads fail with the node's own error", async () => {
    const result = await readNameSymbolAnswering({
      status: 200,
      contentType: "application/json",
      body: (id) =>
        JSON.stringify({ jsonrpc: "2.0", id, error: { code: -32000, message: "invalid opcode: INVALID" } }),
    });
    expect(result).toEqual({ name: undefined, symbol: undefined, definitive: true });
  });

  it("caches a contract that reverts both reads", async () => {
    const result = await readNameSymbolAnswering({
      status: 200,
      contentType: "application/json",
      body: (id) =>
        JSON.stringify({ jsonrpc: "2.0", id, error: { code: 3, message: "execution reverted", data: "0x" } }),
    });
    expect(result).toEqual({ name: undefined, symbol: undefined, definitive: true });
  });
});
