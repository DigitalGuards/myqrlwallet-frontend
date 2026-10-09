import Web3 from "@theqrl/web3";
import { SEND_TX_POLLING_CONFIG } from "../txPolling";

const HASH = `0x${"a".repeat(64)}`;

afterEach(() => {
  jest.clearAllTimers();
  jest.useRealTimers();
});

it.each([false, true])(
  "bounds the installed web3 PromiEvent receipt wait to five minutes (signed=%s)",
  async (signed) => {
    jest.useFakeTimers();
    const request = jest.fn(async ({ method }: { method: string }) => ({
      jsonrpc: "2.0",
      id: 1,
      result:
        method === "qrl_sendTransaction" || method === "qrl_sendRawTransaction"
          ? HASH
          : method === "qrl_getTransactionReceipt"
            ? null
            : "0x1",
    }));
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
    expect(onHash).toHaveBeenCalledWith(HASH);
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
