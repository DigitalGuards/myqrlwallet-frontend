/**
 * Single source of truth for the QRL address format.
 *
 * The QRL next-gen chain moves addresses from 20 bytes ("Q" + 40 hex, EIP-55)
 * to 64 bytes ("Q" + 128 hex, SHAKE256(descriptor ‖ pubkey)[:64]). To let the
 * current 20-byte testnet and a future 64-byte testnet coexist, every
 * address-format assumption (length, regex, derivation slice, checksum) lives
 * here and is selected per network (see `config/networks.ts` `addressFormat`).
 *
 * Phase 0 (now): only `legacy20` is in force; behavior is unchanged. Flipping a
 * network to `nextgen64` is a one-line config change once the chain and the
 * @theqrl libs ship 64-byte support. Do NOT route runtime through `nextgen64`
 * until the open protocol questions are answered (checksum scheme + the
 * wallet.js derivation API) — see the 64-byte migration plan.
 */

export type AddressChecksum = 'eip55' | 'shake256' | 'none';
export type AddressFormatId = 'legacy20' | 'nextgen64';

export interface AddressFormat {
  id: AddressFormatId;
  /** Address byte length, excluding the "Q" prefix. */
  byteLen: number;
  /** Hex-char count after the "Q" prefix (= byteLen * 2). */
  hexLen: number;
  /** Full string length including the "Q" prefix (= hexLen + 1). */
  totalLen: number;
  /** Validates the hex tail after "Q". */
  hexRegex: RegExp;
  /** Validates the full "Q"-prefixed string. */
  fullRegex: RegExp;
  /**
   * [start, end] bounds for slicing @theqrl/wallet.js `getAddressStr()` down to
   * the on-chain address. This is the current derivation shim; Phase 1 replaces
   * it with a typed wallet.js API rather than a hardcoded slice.
   */
  identitySlice: readonly [number, number];
  /** Checksum scheme the chain applies to this address width. */
  checksum: AddressChecksum;
}

export const LEGACY_20: AddressFormat = {
  id: 'legacy20',
  byteLen: 20,
  hexLen: 40,
  totalLen: 41,
  hexRegex: /^[0-9a-fA-F]{40}$/,
  fullRegex: /^Q[0-9a-fA-F]{40}$/,
  identitySlice: [1, 41],
  checksum: 'eip55',
};

/**
 * Provisional. The checksum scheme and the wallet.js derivation for 64-byte
 * addresses are OPEN QUESTIONS pending the QRL devs (the chain may use
 * go-qrllib's SHAKE256 `checksummedHex` rather than EIP-55, and `getAddressStr`
 * / `seedToAccount` shapes may change). These values are wired but inert until
 * a network selects this format.
 */
export const NEXTGEN_64: AddressFormat = {
  id: 'nextgen64',
  byteLen: 64,
  hexLen: 128,
  totalLen: 129,
  hexRegex: /^[0-9a-fA-F]{128}$/,
  fullRegex: /^Q[0-9a-fA-F]{128}$/,
  identitySlice: [1, 129],
  checksum: 'shake256',
};

export const ADDRESS_FORMATS: Record<AddressFormatId, AddressFormat> = {
  legacy20: LEGACY_20,
  nextgen64: NEXTGEN_64,
};

/**
 * The format in force when no network context is supplied. Phase 0: legacy20,
 * so all existing call sites keep their exact current behavior.
 */
export const DEFAULT_ADDRESS_FORMAT: AddressFormat = LEGACY_20;

export function formatForId(id: AddressFormatId): AddressFormat {
  return ADDRESS_FORMATS[id];
}
