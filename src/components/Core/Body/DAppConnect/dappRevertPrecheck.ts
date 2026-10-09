/**
 * Ask the node whether a dApp transaction would revert, before signing it.
 *
 * The wallet now answers `qrl_sendTransaction` as soon as the node accepts the
 * broadcast, which is what the dApp is owed and what stops a confirmed send
 * from going unreported. That moves the moment of truth earlier: a transaction
 * that was always going to revert used to surface as a failed receipt, and now
 * it would be answered with a hash and burn the gas anyway.
 *
 * A `qrl_call` with the same fields catches that for free. The call runs
 * against the pending block, so a transaction that depends on one still in the
 * mempool, an approve ahead of the swap it authorizes, is not rejected for
 * depending on state that has not been mined yet.
 *
 * This is advisory. A node that cannot answer, does not support the method, or
 * is slow must never block a send the user asked for, so anything other than a
 * clear revert lets the transaction proceed.
 */

import { ContractExecutionError, Eip838ExecutionError } from "@theqrl/web3";

/**
 * The subset of the provider this needs.
 *
 * `call` is `unknown` because @theqrl/web3 types its own `call` with a
 * TransactionCall that requires `to`, which a contract deployment does not
 * have. It is narrowed once, from unknown, at the call site below.
 */
export interface RevertPrecheckProvider {
  call?: unknown;
}

type RevertPrecheckCall = (
  transaction: Record<string, unknown>,
  blockNumber?: string,
) => Promise<unknown>;

function isRevertPrecheckCall(value: unknown): value is RevertPrecheckCall {
  return typeof value === "function";
}

export interface RevertPrecheckTransaction {
  from?: string | undefined;
  to?: string | undefined;
  value?: string | undefined;
  data?: string | undefined;
  gas?: string | number | undefined;
}

/** Narrow a transaction field to the string the pre-check can send. */
export function asOptionalString(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (typeof value === "number" && Number.isFinite(value)) return `0x${value.toString(16)}`;
  if (typeof value === "bigint") return `0x${value.toString(16)}`;
  return undefined;
}

export class TransactionWouldRevertError extends Error {
  constructor(readonly reason: string) {
    super(
      reason
        ? `This transaction would fail on chain: ${reason}`
        : "This transaction would fail on chain, so it was not sent.",
    );
    this.name = "TransactionWouldRevertError";
  }
}

/** How long the node gets before the pre-check is abandoned. */
export const REVERT_PRECHECK_TIMEOUT_MS = 8_000;

/**
 * Phrases a node uses when execution failed, for the errors the client passes
 * through as text. Anything unrecognised is treated as "could not answer".
 *
 * These only cover `InvalidResponseError`, which carries the node's own
 * message. A genuine revert arrives as something else entirely; see below.
 */
const REVERT_MARKERS = [
  "revert",
  "execution reverted",
  "invalid opcode",
  "out of gas",
  "stack underflow",
  "stack overflow",
];

/** The pre-check gave up waiting. Never a reason to block a send. */
class PrecheckTimeoutError extends Error {
  constructor() {
    super("the node did not answer in time");
    this.name = "PrecheckTimeoutError";
  }
}

function revertReason(error: unknown): string | null {
  // Checked before the message scan: an earlier version phrased its own
  // timeout as "revert pre-check timed out", which the scan below then read
  // as a revert and used to block a send on a slow node.
  if (error instanceof PrecheckTimeoutError) return null;

  // How a real revert actually arrives. @theqrl/web3 wraps a node revert
  // (JSON-RPC code 3, or -32000 "execution reverted") in a
  // ContractExecutionError whose own message is the generic "Error happened
  // while trying to execute a function inside a smart contract". The revert
  // text is only on the inner Eip838ExecutionError. Scanning the outer
  // message for the word "revert" therefore matched nothing, and every real
  // revert was waved through as "the node could not answer".
  if (error instanceof ContractExecutionError) {
    const inner = error.innerError;
    if (inner instanceof Eip838ExecutionError) {
      const detail = inner.message.split(/execution reverted:?/i).pop()?.trim() ?? "";
      return detail || inner.message.trim() || "the call reverted";
    }
    return error.message.trim() || "the call reverted";
  }

  const message =
    error instanceof Error ? error.message : typeof error === "string" ? error : "";
  if (!message) return null;
  const lowered = message.toLowerCase();
  if (!REVERT_MARKERS.some((marker) => lowered.includes(marker))) return null;
  // Node messages are commonly "execution reverted: ERC20: bad allowance".
  const detail = message.split(/execution reverted:?/i).pop()?.trim() ?? "";
  return detail && detail !== message.trim() ? detail : message.trim();
}

function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => { reject(new PrecheckTimeoutError()); }, ms);
    work.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error instanceof Error ? error : new Error(String(error)));
      },
    );
  });
}

/**
 * Throw `TransactionWouldRevertError` when the node says this call reverts.
 *
 * Returns quietly in every other case, including a provider with no `call`, a
 * timeout, and an error that does not look like a revert.
 */
export async function assertTransactionWouldNotRevert(
  provider: RevertPrecheckProvider | null | undefined,
  transaction: RevertPrecheckTransaction,
  timeoutMs: number = REVERT_PRECHECK_TIMEOUT_MS,
): Promise<void> {
  const call = provider?.call;
  if (!isRevertPrecheckCall(call)) return;
  const invoke = call;

  const request: Record<string, unknown> = {};
  if (transaction.from !== undefined) request["from"] = transaction.from;
  if (transaction.to !== undefined) request["to"] = transaction.to;
  if (transaction.value !== undefined) request["value"] = transaction.value;
  if (transaction.data !== undefined) request["data"] = transaction.data;
  if (transaction.gas !== undefined) request["gas"] = transaction.gas;

  try {
    await withTimeout(
      Promise.resolve(invoke.call(provider, request, "pending")),
      timeoutMs,
    );
  } catch (error) {
    const reason = revertReason(error);
    if (reason === null) {
      // The node could not answer. That is not the user's problem and must not
      // stop a send they asked for.
      console.log(
        "[DAppConnect] revert pre-check did not complete:",
        error instanceof Error ? error.message : String(error),
      );
      return;
    }
    throw new TransactionWouldRevertError(reason);
  }
}
