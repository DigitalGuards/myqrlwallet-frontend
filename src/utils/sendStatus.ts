import type { TransactionReceipt } from "@theqrl/web3";
import { isRecord } from "@/utils/guards";
import { historyHash, unsignedQuantity } from "@/utils/transactionHistory";
import { receiptExecutionStatus } from "@/utils/web3/txPolling";

export type SendSigner = "seed" | "extension" | "mobile" | "desktop";

export interface SendDetails {
  from: string;
  to: string;
  amount: string;
  asset: string;
  blockchain: string;
  signer: SendSigner;
}

export type SendReceipt = Pick<
  TransactionReceipt,
  | "transactionHash"
  | "blockHash"
  | "blockNumber"
  | "gasUsed"
  | "effectiveGasPrice"
  | "status"
>;

/** Accept explicit execution status and complete inclusion evidence from the node. */
export function readSendReceipt(value: unknown): SendReceipt | null {
  if (!isRecord(value)) return null;
  const transactionHash = historyHash(value["transactionHash"]);
  const blockHash = historyHash(value["blockHash"]);
  const blockNumber = unsignedQuantity(value["blockNumber"]);
  const gasUsed = unsignedQuantity(value["gasUsed"]);
  const effectiveGasPrice = unsignedQuantity(value["effectiveGasPrice"]);
  const succeeded = receiptExecutionStatus(value["status"]);
  if (
    transactionHash === null ||
    blockHash === null ||
    blockNumber === null ||
    gasUsed === null ||
    succeeded === undefined
  )
    return null;
  return {
    transactionHash,
    blockHash,
    blockNumber,
    gasUsed,
    status: succeeded ? 1n : 0n,
    ...(effectiveGasPrice === null ? {} : { effectiveGasPrice }),
  };
}

export function sendErrorMessage(error: unknown): string {
  if (typeof error === "string" && error.trim()) return error;
  if (isRecord(error)) {
    // RPC implementations put an execution reason in either field.
    const reason = error["reason"];
    if (typeof reason === "string" && reason.trim()) return reason;
    const data = error["data"];
    if (isRecord(data)) {
      const message = data["message"];
      if (typeof message === "string" && message.trim()) return message;
    }
    const message = error["message"];
    if (typeof message === "string" && message.trim()) return message;
  }
  return "Transaction failed. Please try again.";
}

export function revertedTransactionMessage(receipt: unknown): string {
  if (isRecord(receipt)) {
    for (const key of ["revertReason", "reason"]) {
      const reason = receipt[key];
      if (typeof reason === "string" && reason.trim())
        return `Transaction reverted: ${reason}`;
    }
  }
  return "Transaction execution failed. The transfer was reverted.";
}

/** Match signer outcomes narrowly so node and transport failures stay technical failures. */
export function approvalRejection(error: unknown): string | null {
  const message = sendErrorMessage(error);
  if (
    /Request timeout: qrl_sendTransaction\b|signer request timed out|approval (?:request )?(?:timed out|expired)/i.test(
      message,
    )
  ) {
    return "The approval request timed out. Check your signer and History before retrying.";
  }
  if (
    /\b(?:user (?:cancelled|canceled)|(?:request|approval) (?:was )?(?:cancelled|canceled)|session terminated by wallet)\b/i.test(
      message,
    )
  ) {
    return "The approval request was cancelled.";
  }
  if (
    (isRecord(error) && error["code"] === 4001) ||
    /\b(?:user rejected|rejected by (?:the )?user|user denied)\b/i.test(message)
  ) {
    return "The transaction was declined or the approval request was closed in your signer.";
  }
  return null;
}
