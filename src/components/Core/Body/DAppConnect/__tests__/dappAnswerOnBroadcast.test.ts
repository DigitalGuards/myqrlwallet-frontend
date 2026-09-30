/**
 * A dApp transaction request is answered when the node accepts the broadcast,
 * and answered exactly once.
 *
 * These wire the real settlement adapter to the real one-shot answer, so the
 * sequences a PromiEvent actually produces decide the outcome.
 */
import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { waitForDAppBroadcastSettlement } from "../dappBroadcastSettlement";
import { createDAppRequestAnswer } from "../dappRequestAnswer";

const approve = jest.fn((_result: unknown) => undefined);
const reject = jest.fn((_message: string) => undefined);

beforeEach(() => {
  jest.clearAllMocks();
});

/** A PromiEvent stand-in that replays a scripted sequence of events. */
function scriptedPromiEvent(events: Array<[string, unknown]>) {
  const listeners = new Map<string, (value: unknown) => void>();
  queueMicrotask(() => {
    for (const [name, value] of events) listeners.get(name)?.(value);
  });
  return {
    on(event: string, listener: (value: unknown) => void) {
      listeners.set(event, listener);
      return this;
    },
  };
}

const HASH = "0xabc123";
const receipt = (status: unknown) => ({ transactionHash: HASH, status });

/** The wiring DAppApprovalModal uses, minus the React around it. */
async function settle(events: Array<[string, unknown]>) {
  const answer = createDAppRequestAnswer({ approve, reject });
  const progress: string[] = [];
  await waitForDAppBroadcastSettlement(scriptedPromiEvent(events), {
    onTransactionHash: (hash) => {
      progress.push("confirming");
      answer.answer(hash);
    },
    onSuccess: () => {
      progress.push("confirmed");
    },
    onFailure: (message) => {
      progress.push("failed");
      answer.reject(`Transaction failed: ${message}`);
    },
    onUnknown: (hash, message) => {
      progress.push("unknown");
      if (hash) answer.answer(hash);
      else answer.reject(message);
    },
  });
  return progress;
}

describe("answering at broadcast", () => {
  it("answers with the hash as soon as the node accepts it", async () => {
    const progress = await settle([
      ["transactionHash", HASH],
      ["receipt", receipt("0x1")],
    ]);

    expect(approve).toHaveBeenCalledWith(HASH);
    expect(approve).toHaveBeenCalledTimes(1);
    expect(reject).not.toHaveBeenCalled();
    // The wallet still shows the confirmation it waited for.
    expect(progress).toEqual(["confirming", "confirmed"]);
  });

  it("does not answer a second time when the receipt arrives", async () => {
    await settle([
      ["transactionHash", HASH],
      ["receipt", receipt("0x1")],
    ]);

    expect(approve).toHaveBeenCalledTimes(1);
  });

  it("does not reject after a revert, because the dApp holds a real hash", async () => {
    // The transaction exists on chain and the dApp observes its outcome
    // there. Rejecting here would say the request failed while a transaction
    // it can look up is on its way.
    const progress = await settle([
      ["transactionHash", HASH],
      ["receipt", receipt("0x0")],
    ]);

    expect(approve).toHaveBeenCalledWith(HASH);
    expect(reject).not.toHaveBeenCalled();
    expect(progress).toEqual(["confirming", "failed"]);
  });

  it("does not reject when confirmation is merely unavailable", async () => {
    const progress = await settle([
      ["transactionHash", HASH],
      ["error", new Error("receipt polling gave up")],
    ]);

    expect(approve).toHaveBeenCalledWith(HASH);
    expect(reject).not.toHaveBeenCalled();
    expect(progress).toEqual(["confirming", "unknown"]);
  });

  it("rejects when the broadcast itself failed, with no hash", async () => {
    // Nothing reached the chain, so the request genuinely failed.
    const progress = await settle([
      ["error", new Error("insufficient funds for gas * price + value")],
    ]);

    expect(approve).not.toHaveBeenCalled();
    expect(reject).toHaveBeenCalledTimes(1);
    expect(progress).toEqual(["failed"]);
  });

  it("survives the receipt arriving with an unreadable status", async () => {
    const progress = await settle([
      ["transactionHash", HASH],
      ["receipt", { transactionHash: HASH, status: "not a status" }],
    ]);

    expect(approve).toHaveBeenCalledWith(HASH);
    expect(reject).not.toHaveBeenCalled();
    expect(progress).toEqual(["confirming", "unknown"]);
  });
});

describe("the one-shot answer", () => {
  it("sends the first outcome and ignores the rest", () => {
    const answer = createDAppRequestAnswer({ approve, reject });
    answer.answer("first");
    answer.answer("second");
    answer.reject("too late");

    expect(approve).toHaveBeenCalledTimes(1);
    expect(approve).toHaveBeenCalledWith("first");
    expect(reject).not.toHaveBeenCalled();
    expect(answer.answered).toBe(true);
  });

  it("reports nothing sent until something is", () => {
    const answer = createDAppRequestAnswer({ approve, reject });
    expect(answer.answered).toBe(false);
    answer.reject("no");
    expect(answer.answered).toBe(true);
    expect(approve).not.toHaveBeenCalled();
  });
});

describe("watching an unknown broadcast outcome", () => {
  // Behaviour of the poller itself lives in utils/web3/__tests__/txPolling.
  // What can only be checked here is that the modal actually hands it a
  // cancellation, since nothing else stops it polling for seven minutes on a
  // phone whose user closed the modal long ago.
  it("hands the receipt poller a cancellation tied to the live approval", () => {
    const source = readFileSync(
      join(__dirname, "..", "DAppApprovalModal.tsx"),
      "utf8",
    );
    const watcher = source.slice(
      source.indexOf("const watchUnknownTransaction"),
    );
    const call = watcher.slice(0, watcher.indexOf("};"));

    expect(call).toContain("waitForTransactionReceipt");
    expect(call).toMatch(/cancelled:\s*\(\)\s*=>\s*!isStillCurrent\(\)/);
  });
});
