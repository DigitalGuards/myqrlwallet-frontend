/**
 * The name()/symbol() negative cache is only allowed to hold answers the
 * node actually gave. isTransientRpcError draws that line: a revert or
 * undecodable return is an answer, a dead socket is not.
 */
// nft.ts pulls SERVER_URL from the Vite-only config barrel; the
// classifier under test needs none of it.
jest.mock("@/config", () => ({ SERVER_URL: "https://wallet.example" }));

import { createServer } from "node:http";
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
