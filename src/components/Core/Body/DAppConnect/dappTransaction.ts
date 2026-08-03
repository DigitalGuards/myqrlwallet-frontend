export interface DAppTransactionBuildContext {
  gas: string | number;
  nonce: number;
  gasPriceHex: string;
}

/** Preserve an explicitly reviewed gas value, including numeric zero. */
export function requestedGasLimit(
  params: Record<string, unknown>,
): string | number | undefined {
  if (!Object.prototype.hasOwnProperty.call(params, 'gas')) return undefined;
  const gas = params['gas'];
  return typeof gas === 'string' || typeof gas === 'number' ? gas : undefined;
}

/**
 * Bind every dApp-supplied field shown by DAppTransactionReview into the
 * object handed to web3 signing. Wallet-derived fee and nonce fields are
 * intentionally added separately.
 */
export function buildReviewedDAppTransaction(
  params: Record<string, unknown>,
  context: DAppTransactionBuildContext,
): Record<string, unknown> {
  return {
    from: params['from'],
    to: params['to'],
    value: params['value'] ?? '0x0',
    gas: context.gas,
    maxFeePerGas: context.gasPriceHex,
    maxPriorityFeePerGas: context.gasPriceHex,
    nonce: context.nonce,
    data: params['data'] ?? '0x',
    type: '0x2',
  };
}
