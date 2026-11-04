import Web3, { utils } from "@theqrl/web3";
import type { JsonRpcId } from "@theqrl/web3";
import { SEND_TX_POLLING_CONFIG } from "../txPolling";

/** What the node answers for qrl_sendTransaction, where it signs itself. */
const NODE_SIGNED_HASH = `0x${"a".repeat(64)}`;

afterEach(() => {
  jest.clearAllTimers();
  jest.useRealTimers();
});

it.each([false, true])(
  "bounds the installed web3 PromiEvent receipt wait to five minutes (signed=%s)",
  async (signed) => {
    jest.useFakeTimers();
    // The reply echoes the request id, and a raw broadcast is answered with
    // keccak256 of the bytes sent: @theqrl/web3 2.0.0 refuses a mismatched id
    // and a hash that is not the one it computed locally.
    let broadcastHash = "";
    const request = jest.fn(
      ({ id, method, params }: { id?: JsonRpcId; method: string; params?: unknown }) => {
        let result: unknown = "0x1";
        if (method === "qrl_sendTransaction") {
          broadcastHash = NODE_SIGNED_HASH;
          result = broadcastHash;
        } else if (method === "qrl_sendRawTransaction") {
          const raw = Array.isArray(params) && typeof params[0] === "string" ? params[0] : "";
          broadcastHash = utils.sha3Raw(raw);
          result = broadcastHash;
        } else if (method === "qrl_getTransactionReceipt") {
          result = null;
        }
        return Promise.resolve({ jsonrpc: "2.0", id, result });
      },
    );
    const { qrl } = new Web3({
      provider: { request, supportsSubscriptions: () => false },
    });
    Object.assign(qrl, SEND_TX_POLLING_CONFIG);
    const transaction = {
      from: `Q${"1".repeat(128)}`,
      to: `Q${"2".repeat(128)}`,
      value: "0x0",
      gas: "0x5208",
      nonce: "0x0",
      maxFeePerGas: "0x64",
      maxPriorityFeePerGas: "0x1",
      type: "0x2",
      chainId: "0x1",
      networkId: "0x1",
    };
    const account = qrl.accounts.create();
    const raw = signed
      ? await qrl.accounts.signTransaction(
          { ...transaction, from: account.address },
          account.seed,
        )
      : null;
    const sending = raw
      ? qrl.sendSignedTransaction(raw.rawTransaction, undefined, {
          checkRevertBeforeSending: false,
        })
      : qrl.sendTransaction(transaction, undefined, {
          checkRevertBeforeSending: false,
        });
    const onHash = jest.fn();
    const onReceipt = jest.fn();
    const onError = jest.fn();
    sending.on("transactionHash", onHash);
    sending.on("receipt", onReceipt);
    sending.on("error", onError);
    const onRejected = jest.fn((error: unknown) => error);
    const outcome = sending.then(() => "confirmed", onRejected);
    await jest.advanceTimersByTimeAsync(1);
    expect(broadcastHash).toMatch(/^0x[0-9a-f]{64}$/);
    expect(onHash).toHaveBeenCalledWith(broadcastHash);
    await jest.advanceTimersByTimeAsync(299998);
    expect(onReceipt).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
    expect(onRejected).not.toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(2);
    expect(await outcome).toMatchObject({
      name: "TransactionPollingTimeoutError",
    });
    expect(onRejected).toHaveBeenCalledTimes(1);
    expect(onReceipt).not.toHaveBeenCalled();
    const receiptRequests = request.mock.calls.filter(
      ([args]) => args.method === "qrl_getTransactionReceipt",
    );
    expect(receiptRequests.length).toBeGreaterThanOrEqual(60);
    expect(receiptRequests.length).toBeLessThanOrEqual(61);
  },
);
