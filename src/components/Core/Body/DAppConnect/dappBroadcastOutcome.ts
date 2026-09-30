/**
 * Did the node refuse this transaction, or did we simply never hear back?
 *
 * A broadcast that fails without a hash has two very different meanings, and
 * treating them alike costs the user money either way.
 *
 * The node answered with a JSON-RPC error: nonce too low, insufficient funds,
 * already known, a revert at broadcast. The transaction was not accepted, and
 * the dApp should be told the request failed so the user can fix it and try
 * again.
 *
 * We never heard back: the request timed out, the connection dropped, a proxy
 * returned 5xx after the request left. The node may well have accepted the
 * transaction. Reporting a rejection then is the pay-twice bug in its purest
 * form: the user is told it failed, sends again, and both land.
 *
 * The transaction hash is known locally before any of this, because it is
 * derived from the signed bytes. So the ambiguous case can still answer the
 * dApp with the real hash and let both sides watch the chain, which is what
 * the browser extension does (DigitalGuards/myqrlwallet-extension#65, F2).
 *
 * The classification is by class rather than by message. Measured against
 * @theqrl/web3 1.0.3 with a fake provider:
 *
 *   nonce too low          InvalidResponseError    (extends ResponseError)
 *   insufficient funds     InvalidResponseError
 *   already known          InvalidResponseError
 *   revert at broadcast    ContractExecutionError
 *   fetch failed           TypeError
 *   aborted or timed out   Error, name AbortError
 *   proxy 5xx              Error
 *
 * Every definitive one is the client turning a JSON-RPC error object into a
 * typed error, which only happens when the node replied. Transport failures
 * stay plain.
 */
import { ContractExecutionError, ResponseError } from "@theqrl/web3";

/**
 * True when the node itself refused the transaction, so it is certainly not
 * in the mempool.
 *
 * False for anything that leaves the outcome open, which is the safe default:
 * an unrecognised error is treated as "we do not know".
 */
export function isDefinitiveBroadcastRejection(error: unknown): boolean {
  if (error instanceof ContractExecutionError) return true;
  // InvalidResponseError and its siblings. The client raises these only from a
  // JSON-RPC error object, which means the node replied.
  if (error instanceof ResponseError) return true;
  return false;
}

/** What the wallet shows when a broadcast outcome cannot be established. */
export const UNKNOWN_BROADCAST_MESSAGE =
  "The network did not confirm whether this transaction was accepted. " +
  "Check the explorer before sending it again.";
