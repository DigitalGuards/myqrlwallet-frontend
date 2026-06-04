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
 */
export const QRL_TX_POLLING_CONFIG = {
  transactionPollingInterval: 7000,
  transactionConfirmationBlocks: 1,
  transactionPollingTimeout: 7 * 60 * 1000, // ~7 blocks before giving up
};
