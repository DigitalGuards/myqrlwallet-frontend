import { describe, expect, it, jest } from "@jest/globals";
import { Web3 } from "@theqrl/web3";
import {
  TransactionWouldRevertError,
  asOptionalString,
  assertTransactionWouldNotRevert,
} from "../dappRevertPrecheck";

const tx = { from: `Q${"1".repeat(128)}`, to: `Q${"2".repeat(128)}`, value: "0x0", data: "0xdead", gas: "0x5208" };

/** A real Web3 whose node answers qrl_call with one JSON-RPC error. */
function nodeAnswering(error: { code: number; message: string; data?: string }) {
  return new Web3({
    provider: {
      request: async ({ method }: { method: string }) => {
        if (method === "qrl_call") return { jsonrpc: "2.0", id: 1, error };
        return { jsonrpc: "2.0", id: 1, result: null };
      },
      supportsSubscriptions: () => false,
    },
  });
}

describe("revert pre-check", () => {
  it("passes a call that returns", async () => {
    const call = jest.fn(async () => "0x");
    await expect(
      assertTransactionWouldNotRevert({ call }, tx),
    ).resolves.toBeUndefined();
    expect(call).toHaveBeenCalledTimes(1);
  });

  it("asks against the pending block", async () => {
    // A transaction that depends on one still in the mempool, an approve
    // ahead of the swap it authorizes, must not be refused for depending on
    // state that has not been mined.
    const call = jest.fn(
      async (_transaction: Record<string, unknown>, _block?: string) => "0x",
    );
    await assertTransactionWouldNotRevert({ call }, tx);

    const firstCall = call.mock.calls[0];
    if (!firstCall) throw new Error("expected the pre-check to call the node");
    expect(firstCall[1]).toBe("pending");
    expect(firstCall[0]).toEqual(tx);
  });

  it("stops a transaction the node says reverts", async () => {
    // Driven through the real client, because @theqrl/web3 does not surface a
    // revert as an Error whose message says "revert". It wraps it in a
    // ContractExecutionError whose own message is generic, with the revert
    // text only on the inner Eip838ExecutionError. A hand-made
    // `new Error("execution reverted: ...")` hides that entirely, and the
    // first version of this check passed such a test while letting every real
    // revert through.
    const web3 = nodeAnswering({
      code: 3,
      message: "execution reverted: ERC20: transfer amount exceeds balance",
      data: "0x08c379a0",
    });
    await expect(
      assertTransactionWouldNotRevert(web3.qrl, tx),
    ).rejects.toThrow(TransactionWouldRevertError);
  });

  it("carries the node's reason, so the user sees why", async () => {
    const web3 = nodeAnswering({
      code: 3,
      message: "execution reverted: ERC20: transfer amount exceeds balance",
    });
    await expect(
      assertTransactionWouldNotRevert(web3.qrl, tx),
    ).rejects.toThrow(/ERC20: transfer amount exceeds balance/);
  });

  it("stops a bare execution-reverted with no reason string", async () => {
    const web3 = nodeAnswering({ code: -32000, message: "execution reverted" });
    await expect(
      assertTransactionWouldNotRevert(web3.qrl, tx),
    ).rejects.toThrow(TransactionWouldRevertError);
  });

  it("lets a node that does not serve the method through", async () => {
    // InvalidResponseError, which is what "could not answer" really looks
    // like through the client.
    const web3 = nodeAnswering({
      code: -32601,
      message: "the method qrl_call does not exist/is not available",
    });
    await expect(
      assertTransactionWouldNotRevert(web3.qrl, tx),
    ).resolves.toBeUndefined();
  });

  it("lets the send proceed when the node simply could not answer", async () => {
    // Advisory only. A node that is unreachable, slow, or does not serve the
    // method must never block a send the user asked for.
    for (const failure of [
      new Error("Method not found"),
      new Error("connection refused"),
      new Error("the server is busy"),
    ]) {
      const call = jest.fn(async () => {
        throw failure;
      });
      await expect(
        assertTransactionWouldNotRevert({ call }, tx),
      ).resolves.toBeUndefined();
    }
  });

  it("lets the send proceed on a provider with no call method", async () => {
    await expect(
      assertTransactionWouldNotRevert({}, tx),
    ).resolves.toBeUndefined();
    await expect(
      assertTransactionWouldNotRevert(null, tx),
    ).resolves.toBeUndefined();
  });

  it("gives up rather than holding the send open", async () => {
    const call = jest.fn(() => new Promise<string>(() => undefined));
    await expect(
      assertTransactionWouldNotRevert({ call }, tx, 10),
    ).resolves.toBeUndefined();
  });

  it("omits fields the transaction does not have", async () => {
    const call = jest.fn(
      async (_transaction: Record<string, unknown>, _block?: string) => "0x",
    );
    // A contract deployment has no `to`.
    await assertTransactionWouldNotRevert({ call }, { from: "Q01", data: "0x60" });

    const deployCall = call.mock.calls[0];
    if (!deployCall) throw new Error("expected the pre-check to call the node");
    expect(deployCall[0]).toEqual({ from: "Q01", data: "0x60" });
    expect("to" in deployCall[0]).toBe(false);
  });
});

describe("field narrowing", () => {
  it("passes strings through and hexes numbers", () => {
    expect(asOptionalString("0x1")).toBe("0x1");
    expect(asOptionalString(21000)).toBe("0x5208");
    expect(asOptionalString(BigInt(21000))).toBe("0x5208");
  });

  it("drops anything else", () => {
    for (const value of [undefined, null, {}, [], Number.NaN, true]) {
      expect(asOptionalString(value)).toBeUndefined();
    }
  });
});
