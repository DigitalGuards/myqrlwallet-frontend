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
 * @theqrl/web3 1.0.3 through a real HttpProvider and a local server:
 *
 *   node JSON-RPC error on HTTP 200   InvalidResponseError    definitive
 *   revert at broadcast               ContractExecutionError  definitive
 *   backend 500 or 503 with JSON      ResponseError           unknown
 *   proxy 502 or 524 with an HTML body ResponseError          unknown
 *   connection reset                  FetchError              unknown
 *   client timeout                    ConnectionTimeoutError  unknown
 *
 * The distinction is narrower than "the client raised a typed error". The HTTP
 * provider throws a bare `ResponseError` for ANY non-2xx response, and for a
 * body it cannot parse, before any JSON-RPC processing happens. The wallet's
 * own backend returns 502 when its upstream call times out, which is exactly
 * the moment the node may already have accepted the transaction, and
 * Cloudflare's 502 and 524 pages arrive the same way. Treating those as
 * definitive rejected the very case this exists to catch.
 *
 * Only an in-band JSON-RPC error, which means an HTTP 2xx carrying an `error`
 * object, proves the node saw the transaction and refused it. That is
 * `InvalidResponseError`, and `ContractExecutionError` for a revert.
 */
import { ContractExecutionError, InvalidResponseError } from "@theqrl/web3";
import { describeUnknown } from "@/utils/guards";

/**
 * True when the node itself refused the transaction, so it is certainly not
 * in the mempool.
 *
 * False for anything that leaves the outcome open, which is the safe default:
 * an unrecognised error is treated as "we do not know".
 */
export function isDefinitiveBroadcastRejection(error: unknown): boolean {
  if (error instanceof ContractExecutionError) return true;
  // InvalidResponseError only, which the client raises from a JSON-RPC error
  // object on an HTTP 2xx. A bare ResponseError is any non-2xx or unparseable
  // body, including the backend's own 502 on an upstream timeout, and says
  // nothing about whether the node saw the transaction.
  if (error instanceof InvalidResponseError) {
    // "already known" means the transaction IS in the pool. The desktop main
    // process treats the same reply as success for this reason. Refusing it
    // would reject a request whose transaction is on its way, which is how a
    // failover between endpoints turns into a second payment.
    return !isAlreadyKnown(error);
  }
  return false;
}

/**
 * The node is telling us it already has this transaction.
 *
 * Matches the desktop main process (`DUPLICATE_TX_RE` in its rpc module), so
 * the two surfaces agree about what a duplicate means.
 */
const DUPLICATE_TX_RE = /already known|known transaction|already exists/i;

export function isAlreadyKnown(error: unknown): boolean {
  const message = error instanceof Error ? error.message : describeUnknown(error);
  return DUPLICATE_TX_RE.test(message);
}

/** What the wallet shows when a broadcast outcome cannot be established. */
export const UNKNOWN_BROADCAST_MESSAGE =
  "The network did not confirm whether this transaction was accepted. " +
  "Check the explorer before sending it again.";
