import { describe, expect, it, jest } from "@jest/globals";
import {
  TransactionWouldRevertError,
  asOptionalString,
  assertTransactionWouldNotRevert,
} from "../dappRevertPrecheck";

const tx = { from: "Q01", to: "Q02", value: "0x0", data: "0xdead", gas: "0x5208" };

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
    const call = jest.fn(async () => {
      throw new Error("execution reverted: ERC20: transfer amount exceeds balance");
    });
    await expect(assertTransactionWouldNotRevert({ call }, tx)).rejects.toThrow(
      TransactionWouldRevertError,
    );
  });

  it("carries the node's reason, so the user sees why", async () => {
    const call = jest.fn(async () => {
      throw new Error("execution reverted: ERC20: transfer amount exceeds balance");
    });
    await expect(assertTransactionWouldNotRevert({ call }, tx)).rejects.toThrow(
      /ERC20: transfer amount exceeds balance/,
    );
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
