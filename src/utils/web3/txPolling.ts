/**
 * web3.js transaction-polling config tuned for QRL's ~60-second block time.
 *
 * web3.js 4.x defaults are `transactionPollingInterval: 1000` (poll the receipt
 * every 1s) and `transactionConfirmationBlocks: 24` (keep polling for 24
 * confirmations after the receipt). On a 1-minute-block chain that fires ~100+
 * `getTransactionReceipt` / block RPC calls per transaction (~60 just to see
 * the receipt, then ~24 blocks ≈ 24 minutes of confirmation polling).
 *
 * These values poll every 7s and require a single confirmation, cutting it to
 * roughly ~10 RPC calls per tx. The user-facing "confirmed" state fires on the
 * `receipt` event (first inclusion), which is unaffected by
 * `transactionConfirmationBlocks` — that only controls how long web3 keeps
 * watching for additional confirmations afterward.
 *
 * NOTE on units: in web3.js 4.x BOTH `transactionPollingInterval` and
 * `transactionPollingTimeout` are MILLISECONDS (the default timeout is
 * `750 * 1000`, and web3 divides it by 1000 only to render the seconds in its
 * timeout error). This differs from web3.js 1.x where the timeout was seconds —
 * do not "convert" the timeout to seconds.
 */
export const QRL_TX_POLLING_CONFIG = {
  transactionPollingInterval: 7000, // ms
  transactionConfirmationBlocks: 1,
  transactionPollingTimeout: 7 * 60 * 1000, // ms (7 min, ~7 blocks) — NOT seconds
};
