export interface DAppTransactionBuildContext {
  gas: string | number;
  nonce: number;
  gasPriceHex: string;
}

/** Preserve an explicitly reviewed gas value, including numeric zero. */
export function requestedGasLimit(params: Record<string, unknown>): string | number | undefined {
  if (!Object.prototype.hasOwnProperty.call(params, 'gas')) return undefined;
  const gas = params['gas'];
  return typeof gas === 'string' || typeof gas === 'number' ? gas : undefined;
}

/**
 * Normalise a reviewed dApp gas limit into the canonical decimal string the
 * desktop bridge's `buildTransaction` takes.
 *
 * The dApp wire form is an RPC quantity (`0x...`) or, for tolerance, a number;
 * the desktop schema is a canonical positive base-10 string, so convert once
 * here. Returns undefined when there is nothing worth forwarding, which the
 * desktop builder reads as "estimate it":
 *   - the dApp sent no gas at all;
 *   - the dApp sent zero, which can never produce an executable transaction
 *     (the desktop schema rejects it outright, so it must not be forwarded);
 *   - the value is unusable as an integer.
 *
 * Callers pass the output of {@link requestedGasLimit}, which is already bounded
 * by RequestHandler's `validateRpcQuantity` (canonical quantity, at or below the
 * safe-integer limit), so this never has to defend against unbounded input.
 */
export function desktopGasLimit(gas: string | number | undefined): string | undefined {
  if (gas === undefined) return undefined;
  let asBigInt: bigint;
  try {
    asBigInt = typeof gas === 'number' ? BigInt(Math.trunc(gas)) : BigInt(gas.trim());
  } catch {
    return undefined;
  }
  if (asBigInt <= 0n) return undefined;
  return asBigInt.toString(10);
}

/**
 * Bind every dApp-supplied field shown by DAppTransactionReview into the
 * object handed to web3 signing. Wallet-derived fee and nonce fields are
 * intentionally added separately.
 */
export function buildReviewedDAppTransaction(
  params: Record<string, unknown>,
  context: DAppTransactionBuildContext
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
    ...(params['chainId'] === undefined ? {} : { chainId: params['chainId'] }),
  };
}
