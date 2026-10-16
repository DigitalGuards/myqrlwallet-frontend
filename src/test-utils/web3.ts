import Web3, { core } from "@theqrl/web3";
import type { DataFormat, TransactionReceipt } from "@theqrl/web3";
import type { SendSignedTransactionEvents } from "@theqrl/web3-qrl";
import { TextEncoder } from "node:util";

export function createQrlRpc() {
  // Web3 hashes ABI metadata during setup; jsdom needs Node's encoder.
  Object.defineProperty(globalThis, "TextEncoder", {
    value: TextEncoder,
    configurable: true,
  });
  const unexpectedRequest = () =>
    Promise.reject(new Error("Unexpected RPC request in test"));
  const rpc = new Web3({ request: unexpectedRequest }).qrl;
  jest.spyOn(rpc.requestManager, "send").mockImplementation(unexpectedRequest);
  return rpc;
}

export function signedTransaction(rawTransaction: string) {
  return {
    rawTransaction,
    transactionHash: `0x${"a".repeat(64)}`,
    messageHash: `0x${"b".repeat(64)}`,
    signature: "0x00",
  };
}

export function pendingSend() {
  return new core.Web3PromiEvent<
    TransactionReceipt,
    SendSignedTransactionEvents<DataFormat>
  >(() => undefined);
}

export function blockWithBaseFee(baseFeePerGas: bigint) {
  return {
    parentHash: `0x${"0".repeat(64)}`,
    miner: `Q${"0".repeat(128)}`,
    stateRoot: `0x${"0".repeat(64)}`,
    transactionsRoot: `0x${"0".repeat(64)}`,
    receiptsRoot: `0x${"0".repeat(64)}`,
    number: 0n,
    gasLimit: 30000000n,
    gasUsed: 0n,
    timestamp: 0n,
    extraData: "0x",
    prevRandao: `0x${"0".repeat(64)}`,
    baseFeePerGas,
    size: 0n,
    transactions: [],
  };
}
