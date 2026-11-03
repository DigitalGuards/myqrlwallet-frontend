/**
 * A broadcast that fails without a hash means two different things, and the
 * wallet has to tell them apart. The node refusing the transaction is a
 * rejection. Never hearing back is not: the transaction may be in the mempool,
 * and reporting a rejection is what makes a user send it a second time.
 *
 * The shapes below are produced by the installed @theqrl/web3 driven through a
 * fake provider or a real HttpProvider, so an upgrade that changes them fails
 * here. Every fixture echoes the request id: since 2.0.0 the client refuses a
 * reply whose id does not match, which would otherwise mask the error under
 * test.
 */
import { describe, expect, it } from "@jest/globals";
import { createServer } from "node:http";
import { HttpProvider, InvalidResponseError, Web3 } from "@theqrl/web3";
import type { JsonRpcId } from "@theqrl/web3";
import { isDefinitiveBroadcastRejection } from "../dappBroadcastOutcome";
import { waitForDAppBroadcastSettlement } from "../dappBroadcastSettlement";

const LOCAL_HASH = "0xdd5d4abee99b373e36a58f56fdb2715c5917e22a16355fb396fa2ee930bfa1b6";
// Real HTTP and the first signature share CPU with parallel Jest workers.
const HTTP_BROADCAST_TIMEOUT = 30_000;

/**
 * Bound the receipt poll. sendSignedTransaction otherwise keeps a 750 second
 * timer alive, which outlives the test run: the suite passes, the process sits
 * there, and a TransactionSendTimeoutError rejects twelve minutes later and
 * takes the run down with it.
 */
const SHORT_POLLING = {
  transactionPollingTimeout: 50,
  transactionPollingInterval: 10,
};

/** Plausible answers for the reads web3 makes around a send. */
function healthyResultFor(method: string): unknown {
  switch (method) {
    case "qrl_blockNumber":
      return "0x1";
    case "qrl_chainId":
      return "0x301825";
    case "net_version":
      return "3151909";
    case "qrl_getTransactionReceipt":
      return null;
    default:
      return null;
  }
}

/** Signed once, lazily, and reused: the bytes only have to be well formed. */
let rawSigned: string | null = null;
async function signedTransaction(): Promise<string> {
  if (rawSigned !== null) return rawSigned;
  const web3 = new Web3({
    provider: {
      request: ({ id, method }: { id?: JsonRpcId; method: string }) =>
        Promise.resolve({ jsonrpc: "2.0", id, result: healthyResultFor(method) }),
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

/** What the node puts in the reply envelope for the broadcast. */
type BroadcastReply = { error?: unknown; result?: unknown; id?: JsonRpcId };

/** Run a broadcast whose node behaves as given, and return the real error. */
async function broadcastError(
  behaviour: (rawTransaction: string) => BroadcastReply,
): Promise<Error> {
  const provider = {
    request: ({ id, method, params }: { id?: JsonRpcId; method: string; params?: unknown }) =>
      Promise.resolve().then(() => {
        if (method === "qrl_sendRawTransaction") {
          const raw = Array.isArray(params) && typeof params[0] === "string" ? params[0] : "";
          return { jsonrpc: "2.0", id, ...behaviour(raw) };
        }
        return { jsonrpc: "2.0", id, result: healthyResultFor(method) };
      }),
    supportsSubscriptions: () => false,
  };
  const web3 = new Web3({ provider, config: SHORT_POLLING });
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
    if (!(error instanceof Error)) throw new Error("Expected a broadcast Error");
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
  /** The reply body, or a builder given the request id to echo. */
  body: string | ((id: unknown) => string);
}): Promise<unknown> {
  const rawTransaction = await signedTransaction();
  const server = createServer((req, res) => {
    // The body has to be drained before answering, or a signed transaction
    // large enough to fill the socket buffer blocks the write.
    let body = "";
    req.setEncoding("utf8");
    req.on("data", (chunk: unknown) => {
      if (typeof chunk === "string") body += chunk;
      else req.destroy(new Error("Expected a UTF-8 request body"));
    });
    req.on("end", () => {
      // Only the broadcast fails. Failing everything also failed web3's
      // pre-send qrl_blockNumber read, which it performs outside the
      // try/finally that clears its 750 second send timer: the suite then
      // passed, the process sat there, and the timer rejected long after.
      let method = "";
      let id: unknown = null;
      try {
        const parsed: unknown = JSON.parse(body);
        if (
          typeof parsed === "object" &&
          parsed !== null &&
          "method" in parsed &&
          typeof parsed.method === "string"
        ) {
          method = parsed.method;
          id = "id" in parsed ? parsed.id : null;
        }
      } catch {
        // An unparseable body cannot be the broadcast.
      }
      if (method === "") {
        res.writeHead(400);
        res.end();
        return;
      }
      if (method !== "qrl_sendRawTransaction") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            jsonrpc: "2.0",
            id,
            result: healthyResultFor(method),
          }),
        );
        return;
      }
      res.writeHead(answer.status, { "content-type": answer.contentType });
      res.end(typeof answer.body === "function" ? answer.body(id) : answer.body);
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "localhost", () => {
      server.off("error", reject);
      resolve();
    });
  });
  try {
    const address = server.address();
    if (typeof address !== "object" || address === null) {
      throw new Error("Expected the HTTP fixture to listen on a TCP port");
    }
    const web3 = new Web3({
      provider: new HttpProvider(`http://localhost:${address.port}`),
      config: SHORT_POLLING,
    });
    const sending = web3.qrl.sendSignedTransaction(rawTransaction, undefined, {
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
    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) reject(error);
        else resolve();
      });
      // The response is consumed. Close keep-alive sockets before awaiting exit.
      server.closeAllConnections();
    });
  }
}

const nodeError = (message: string, code = -32000) => (): BroadcastReply => ({
  error: { code, message },
});

/** A JSON-RPC envelope that echoes the request id, as the backend proxy does. */
const rpcBody = (fields: Record<string, unknown>) => (id: unknown) =>
  JSON.stringify({ jsonrpc: "2.0", id, ...fields });

describe("the node refused it, through a real HttpProvider", () => {
  it("treats an in-band JSON-RPC error on HTTP 200 as definitive", async () => {
    const error = await broadcastThroughHttp({
      status: 200,
      contentType: "application/json",
      body: rpcBody({ error: { code: -32000, message: "nonce too low" } }),
    });
    expect(isDefinitiveBroadcastRejection(error)).toBe(true);
  }, HTTP_BROADCAST_TIMEOUT);
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
      error: { code: 3, message: "execution reverted: nope", data: "0x" },
    }));
    expect(isDefinitiveBroadcastRejection(error)).toBe(true);
  });
});

describe("the node answered, but not with a refusal", () => {
  // Since @theqrl/web3 2.0.0 the client checks a broadcast reply before it
  // trusts it, and raises InvalidResponseError, the class an in-band refusal
  // also arrives as, when the check fails. Nothing in these replies says the
  // transaction was refused, and the node may hold it, so each must stay open.
  // Under 1.0.3 the first three resolved and the wallet polled the reply.
  const OTHER_HASH = `0x${"ab".repeat(32)}`;

  it.each([
    ["a hash other than keccak256 of the bytes sent", rpcBody({ result: OTHER_HASH })],
    ["a result that is not a hash", rpcBody({ result: "0x12" })],
    [
      "a result carrying another request's id",
      () => JSON.stringify({ jsonrpc: "2.0", id: "another-request", result: OTHER_HASH }),
    ],
    [
      "a refusal carrying another request's id",
      () =>
        JSON.stringify({
          jsonrpc: "2.0",
          id: "another-request",
          error: { code: -32000, message: "nonce too low" },
        }),
    ],
  ])("treats %s as open", async (_label, body) => {
    const error = await broadcastThroughHttp({ status: 200, contentType: "application/json", body });
    expect(error).toBeInstanceOf(InvalidResponseError);
    expect(isDefinitiveBroadcastRejection(error)).toBe(false);
  }, HTTP_BROADCAST_TIMEOUT);

  it("still treats the node's own refusal of the same request as definitive", async () => {
    const error = await broadcastError(nodeError("nonce too low"));
    expect(error).toBeInstanceOf(InvalidResponseError);
    expect(error.message).toMatch(/^Returned error: /);
    expect(isDefinitiveBroadcastRejection(error)).toBe(true);
  });

  it("answers the dApp with the local hash when the node reports another one", async () => {
    // The pay-twice case again: calling this a failure would have the user
    // send a transaction the node may already hold.
    const error = await broadcastError(() => ({ result: OTHER_HASH }));
    const calls: Array<[string, string]> = [];
    await waitForDAppBroadcastSettlement(
      rejectingPromiEvent(error),
      {
        onTransactionHash: (hash: string) => calls.push(["hash", hash]),
        onSuccess: (hash: string) => calls.push(["success", hash]),
        onFailure: (message: string) => calls.push(["failure", message]),
        onUnknown: (hash: string, _message: string) => calls.push(["unknown", hash]),
      },
      { localHash: LOCAL_HASH },
    );
    expect(calls).toEqual([["unknown", LOCAL_HASH]]);
  });
});

describe("we never heard back", () => {
  // Driven through a real HttpProvider against a local server, because the
  // provider throws its own transport error for ANY non-2xx (HttpStatusError
  // since @theqrl/web3 2.0.0, a bare ResponseError before it) and for a body
  // it cannot parse, before any JSON-RPC processing. Hand-built Errors hide
  // that, and treating those as definitive rejected the very case this
  // module exists for: the wallet's own backend answers 502 when its upstream
  // call times out, which is exactly when the node may have accepted the
  // transaction.
  it.each([
    ["the backend's 502 on an upstream timeout", 502, "application/json", '{"error":"RPC upstream timeout"}'],
    ["a 503 carrying a JSON-RPC envelope", 503, "application/json", rpcBody({ error: { code: -32000, message: "unavailable" } })],
    ["a proxy 502 HTML page", 502, "text/html", "<html><body>Bad gateway</body></html>"],
    ["a proxy 524 HTML page", 524, "text/html", "<html><body>A timeout occurred</body></html>"],
  ])("treats %s as open", async (_label, status, contentType, body) => {
    const error = await broadcastThroughHttp({ status, contentType, body });
    expect(isDefinitiveBroadcastRejection(error)).toBe(false);
  }, HTTP_BROADCAST_TIMEOUT);

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
function rejectingPromiEvent(error: Error) {
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
