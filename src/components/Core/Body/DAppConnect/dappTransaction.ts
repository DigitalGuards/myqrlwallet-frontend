export interface DAppTransactionBuildContext {
  gas: string | number;
  nonce: number;
  /** EIP-1559 fee cap per gas, from the wallet's fee quote. */
  maxFeePerGasHex: string;
  /** EIP-1559 priority tip per gas, from the wallet's fee quote. */
  maxPriorityFeePerGasHex: string;
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
  if (typeof gas === 'number') {
    if (!Number.isSafeInteger(gas)) return undefined;
    asBigInt = BigInt(gas);
  } else {
    // Accept the two spellings an RPC transaction object uses, and only those.
    // BigInt() on its own would also read `0b`/`0o` prefixes and would turn a
    // float-formatted string into a value nobody wrote.
    const text = gas.trim();
    if (!/^(?:0|[1-9][0-9]*)$/.test(text) && !/^0x(?:0|[1-9a-fA-F][0-9a-fA-F]*)$/.test(text)) {
      return undefined;
    }
    asBigInt = BigInt(text);
  }
  if (asBigInt <= 0n) return undefined;
  // Stay inside what RequestHandler already accepts and what the desktop
  // schema's 18-digit cap allows, so anything this returns is a value the
  // desktop boundary can take. A larger request is dropped and main estimates.
  if (asBigInt > BigInt(Number.MAX_SAFE_INTEGER)) return undefined;
  return asBigInt.toString(10);
}

/** The argument object the desktop signer takes for a dApp transaction. */
export interface DesktopTransactionArgs {
  from: string;
  to: string;
  /** Smallest-unit decimal string. */
  value: string;
  data?: string;
  /** Canonical positive decimal gas limit; absent when there is none to send. */
  gas?: string;
}

/**
 * Build the desktop signer's argument object from a reviewed dApp transaction.
 *
 * Both desktop paths (`qrl_sendTransaction` and `qrl_signTransaction`) send the
 * same fields, so they share this one construction: the same recipient, the
 * same smallest-unit value, the same calldata and the same gas limit reach the
 * shell whichever method the dApp called. `from` is passed separately because
 * the approval flow binds it to the live active account at approve-click,
 * deliberately ignoring the dApp's own `from`.
 *
 * Optional keys are omitted when empty: the desktop IPC schema is strict and
 * inspects keys, so an explicit `undefined` would still count as one.
 */
export function desktopTransactionArgs(
  params: Record<string, unknown>,
  from: string,
): DesktopTransactionArgs {
  const data = (params['data'] as string) || undefined;
  const gas = desktopGasLimit(requestedGasLimit(params));
  return {
    from,
    to: params['to'] as string,
    value: params['value'] ? BigInt(params['value'] as string).toString() : '0',
    ...(data === undefined ? {} : { data }),
    ...(gas === undefined ? {} : { gas }),
  };
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
    maxFeePerGas: context.maxFeePerGasHex,
    maxPriorityFeePerGas: context.maxPriorityFeePerGasHex,
    nonce: context.nonce,
    data: params['data'] ?? '0x',
    type: '0x2',
    ...(params['chainId'] === undefined ? {} : { chainId: params['chainId'] }),
  };
}
