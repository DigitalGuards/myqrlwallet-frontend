/**
 * A broadcast that fails without a hash means two different things, and the
 * wallet has to tell them apart. The node refusing the transaction is a
 * rejection. Never hearing back is not: the transaction may be in the mempool,
 * and reporting a rejection is what makes a user send it a second time.
 *
 * The shapes below were measured against @theqrl/web3 1.0.3 driven through a
 * fake provider, which is also how this file produces them.
 */
import { describe, expect, it } from "@jest/globals";
import { createServer } from "node:http";
import { Web3, HttpProvider } from "@theqrl/web3";
import { isDefinitiveBroadcastRejection } from "../dappBroadcastOutcome";
import { waitForDAppBroadcastSettlement } from "../dappBroadcastSettlement";

const LOCAL_HASH = "0xdd5d4abee99b373e36a58f56fdb2715c5917e22a16355fb396fa2ee930bfa1b6";

/** Signed once, lazily, and reused: the bytes only have to be well formed. */
let rawSigned: string | null = null;
async function signedTransaction(): Promise<string> {
  if (rawSigned !== null) return rawSigned;
  const web3 = new Web3({
    provider: {
      request: async () => ({ jsonrpc: "2.0", id: 1, result: null }),
      supportsSubscriptions: () => false,
    },
  });
  const account = web3.qrl.accounts.create();
  const signed = await web3.qrl.accounts.signTransaction(
    {
      from: account.address,
      to: `Q${"2".repeat(128)}`,
      value: "0x0",
      data: "0xdead",
      gas: 100000,
      nonce: 0,
      maxFeePerGas: "0x3b9aca00",
      maxPriorityFeePerGas: "0x1",
      chainId: 3151909,
      networkId: 3151909,
      type: 2,
    },
    account.seed,
  );
  rawSigned = signed.rawTransaction;
  return rawSigned;
}

/** Run a broadcast whose node behaves as given, and return the real error. */
async function broadcastError(
  behaviour: () => { jsonrpc: string; id: number; error?: unknown; result?: unknown },
): Promise<unknown> {
  const provider = {
    request: async ({ method }: { method: string }) => {
      if (method === "qrl_sendRawTransaction") return behaviour();
      if (method === "qrl_chainId") return { jsonrpc: "2.0", id: 1, result: "0x301825" };
      if (method === "net_version") return { jsonrpc: "2.0", id: 1, result: "3151909" };
      if (method === "qrl_blockNumber") return { jsonrpc: "2.0", id: 1, result: "0x1" };
      return { jsonrpc: "2.0", id: 1, result: null };
    },
    supportsSubscriptions: () => false,
  };
  const web3 = new Web3({ provider });
  const account = web3.qrl.accounts.create();
  const signed = await web3.qrl.accounts.signTransaction(
    {
      from: account.address,
      to: `Q${"2".repeat(128)}`,
      value: "0x0",
      data: "0xdead",
      gas: 100000,
      nonce: 0,
      maxFeePerGas: "0x3b9aca00",
      maxPriorityFeePerGas: "0x1",
      chainId: 3151909,
      networkId: 3151909,
      type: 2,
    },
    account.seed,
  );
  const sending = web3.qrl.sendSignedTransaction(signed.rawTransaction, undefined, {
    checkRevertBeforeSending: false,
  });
  sending.on("error", () => undefined);
  try {
    await sending;
    throw new Error("expected the broadcast to fail");
  } catch (error) {
    return error;
  }
}

/**
 * Run a real broadcast through a real HttpProvider against a local server
 * that answers exactly once, and return the error the client produced.
 */
async function broadcastThroughHttp(answer: {
  status: number;
  contentType: string;
  body: string;
}): Promise<unknown> {
  const server = createServer((req, res) => {
    // The request body has to be drained before answering, or a signed
    // transaction large enough to fill the socket buffer blocks the write and
    // the call never returns.
    req.on("data", () => undefined);
    req.on("end", () => {
      res.writeHead(answer.status, { "content-type": answer.contentType });
      res.end(answer.body);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const port = typeof address === "object" && address !== null ? address.port : 0;
  try {
    const web3 = new Web3({
      provider: new HttpProvider(`http://127.0.0.1:${port}`),
    });
    const sending = web3.qrl.sendSignedTransaction(await signedTransaction(), undefined, {
      checkRevertBeforeSending: false,
    });
    sending.on("error", () => undefined);
    try {
      await sending;
      throw new Error("expected the broadcast to fail");
    } catch (error) {
      return error;
    }
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

const nodeError = (message: string, code = -32000) => () => ({
  jsonrpc: "2.0",
  id: 1,
  error: { code, message },
});

describe("the node refused it, through a real HttpProvider", () => {
  it("treats an in-band JSON-RPC error on HTTP 200 as definitive", async () => {
    const error = await broadcastThroughHttp({
      status: 200,
      contentType: "application/json",
      body: '{"jsonrpc":"2.0","id":1,"error":{"code":-32000,"message":"nonce too low"}}',
    });
    expect(isDefinitiveBroadcastRejection(error)).toBe(true);
  });
});

describe("the node refused it", () => {
  it.each([
    ["nonce too low"],
    ["insufficient funds for gas * price + value"],
    ["replacement transaction underpriced"],
    ["intrinsic gas too low"],
  ])("treats %s as definitive", async (message) => {
    const error = await broadcastError(nodeError(message));
    expect(isDefinitiveBroadcastRejection(error)).toBe(true);
  });

  it("treats already known as the transaction being in the pool", async () => {
    // The node is telling us it already holds this transaction, so it is on
    // its way. The desktop signer treats the same reply as success. Calling
    // it a rejection is how an endpoint failover turns into a second payment.
    const error = await broadcastError(nodeError("already known"));
    expect(isDefinitiveBroadcastRejection(error)).toBe(false);
  });

  it("treats a revert at broadcast as definitive", async () => {
    const error = await broadcastError(() => ({
      jsonrpc: "2.0",
      id: 1,
      error: { code: 3, message: "execution reverted: nope", data: "0x" },
    }));
    expect(isDefinitiveBroadcastRejection(error)).toBe(true);
  });
});

describe("we never heard back", () => {
  // Driven through a real HttpProvider against a local server, because the
  // provider throws a bare ResponseError for ANY non-2xx and for a body it
  // cannot parse, before any JSON-RPC processing. Hand-built Errors hide
  // that, and treating those as definitive rejected the very case this
  // module exists for: the wallet's own backend answers 502 when its upstream
  // call times out, which is exactly when the node may have accepted the
  // transaction.
  it.each([
    ["the backend's 502 on an upstream timeout", 502, "application/json", '{"error":"RPC upstream timeout"}'],
    ["a 503 carrying a JSON-RPC envelope", 503, "application/json", '{"jsonrpc":"2.0","id":1,"error":{"code":-32000,"message":"unavailable"}}'],
    ["a proxy 502 HTML page", 502, "text/html", "<html><body>Bad gateway</body></html>"],
    ["a proxy 524 HTML page", 524, "text/html", "<html><body>A timeout occurred</body></html>"],
  ])("treats %s as open", async (_label, status, contentType, body) => {
    const error = await broadcastThroughHttp({ status, contentType, body });
    expect(isDefinitiveBroadcastRejection(error)).toBe(false);
  });

  it.each([
    ["a dropped connection", new TypeError("Failed to fetch")],
    ["an unrecognised failure", new Error("something else entirely")],
  ])("treats %s as open", (_label, error) => {
    expect(isDefinitiveBroadcastRejection(error)).toBe(false);
  });

  it("treats an aborted request as open", () => {
    const aborted = new Error("The user aborted a request.");
    aborted.name = "AbortError";
    expect(isDefinitiveBroadcastRejection(aborted)).toBe(false);
  });

  it("defaults to open for anything that is not an Error", () => {
    for (const value of [undefined, null, "boom", 42, {}]) {
      expect(isDefinitiveBroadcastRejection(value)).toBe(false);
    }
  });
});

/** A PromiEvent stand-in: emits nothing and rejects, as a transport failure does. */
function rejectingPromiEvent(error: unknown) {
  const promise = Promise.reject(error);
  // Observed by the helper; this keeps the test runner quiet in the meantime.
  promise.catch(() => undefined);
  return {
    on() {
      return this;
    },
    then: promise.then.bind(promise),
  };
}

describe("settlement of a broadcast with no hash", () => {
  const callbacks = () => {
    const calls: Array<[string, string]> = [];
    return {
      calls,
      onTransactionHash: (hash: string) => calls.push(["hash", hash]),
      onSuccess: (hash: string) => calls.push(["success", hash]),
      onFailure: (message: string) => calls.push(["failure", message]),
      onUnknown: (hash: string, _message: string) => calls.push(["unknown", hash]),
    };
  };

  it("rejects when the node refused it, even with a local hash", async () => {
    const error = await broadcastError(nodeError("nonce too low"));
    const handlers = callbacks();
    await waitForDAppBroadcastSettlement(rejectingPromiEvent(error), handlers, {
      localHash: LOCAL_HASH,
    });

    expect(handlers.calls).toHaveLength(1);
    expect(handlers.calls[0]?.[0]).toBe("failure");
    expect(handlers.calls[0]?.[1]).toContain("nonce too low");
  });

  it("answers with the local hash when nobody answered", async () => {
    // The pay-twice case: the transaction may be in the mempool, so the dApp
    // gets the real hash and the wallet says the outcome is unknown.
    const handlers = callbacks();
    await waitForDAppBroadcastSettlement(
      rejectingPromiEvent(new TypeError("Failed to fetch")),
      handlers,
      { localHash: LOCAL_HASH },
    );

    expect(handlers.calls).toEqual([["unknown", LOCAL_HASH]]);
  });

  it("still rejects when there is no local hash to offer", async () => {
    const handlers = callbacks();
    await waitForDAppBroadcastSettlement(
      rejectingPromiEvent(new TypeError("Failed to fetch")),
      handlers,
      {},
    );

    expect(handlers.calls).toEqual([["failure", "Failed to fetch"]]);
  });

  it("settles once, even though the rejection and an error event both arrive", async () => {
    const error = await broadcastError(nodeError("already known"));
    const handlers = callbacks();
    const listeners = new Map<string, (value: unknown) => void>();
    const promise = Promise.reject(error);
    promise.catch(() => undefined);
    const source = {
      on(event: string, listener: (value: unknown) => void) {
        listeners.set(event, listener);
        return this;
      },
      then: promise.then.bind(promise),
    };
    const settled = waitForDAppBroadcastSettlement(source, handlers, {
      localHash: LOCAL_HASH,
    });
    listeners.get("error")?.(error);
    await settled;

    expect(handlers.calls).toHaveLength(1);
  });
});
