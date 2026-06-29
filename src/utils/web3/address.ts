/**
 * Address validation utilities for QRL blockchain addresses.
 *
 * The address format (length / hex regex) is NOT hardcoded here — it comes from
 * the per-network `AddressFormat` spec in `config/addressFormat.ts`, so the same
 * validators work for both the current 20-byte ("Q" + 40 hex) and the future
 * 64-byte ("Q" + 128 hex) networks. Callers that know the active network should
 * pass its format (via `getAddressFormat(blockchain)` in `config/networks.ts`);
 * otherwise validation uses the default (legacy 20-byte) format.
 */

import { DEFAULT_ADDRESS_FORMAT, type AddressFormat } from '@/config/addressFormat';

/**
 * Validates if a string is a properly formatted QRL address for the given format.
 * @param address - The address string to validate
 * @param format - Address format to validate against (default: legacy 20-byte)
 * @returns boolean - True if address is valid, false otherwise
 */
export const isValidQrlAddress = (
  address: string,
  format: AddressFormat = DEFAULT_ADDRESS_FORMAT,
): boolean => {
  if (!address || typeof address !== 'string') {
    return false;
  }

  const trimmedAddress = address.trim();

  if (!trimmedAddress.startsWith('Q')) {
    return false;
  }

  if (trimmedAddress.length !== format.totalLen) {
    return false;
  }

  return format.hexRegex.test(trimmedAddress.slice(1));
};

/**
 * Validates and normalizes a QRL address (lowercased hex).
 * @returns string | null - Normalized address or null if invalid
 */
export const normalizeQrlAddress = (
  address: string,
  format: AddressFormat = DEFAULT_ADDRESS_FORMAT,
): string | null => {
  if (!isValidQrlAddress(address, format)) {
    return null;
  }
  const trimmedAddress = address.trim();
  return 'Q' + trimmedAddress.slice(1).toLowerCase();
};

/**
 * Gets a user-friendly error message for invalid addresses.
 */
export const getAddressValidationError = (
  address: string,
  format: AddressFormat = DEFAULT_ADDRESS_FORMAT,
): string => {
  if (!address || address.trim().length === 0) {
    return 'Address is required';
  }

  const trimmedAddress = address.trim();

  if (!trimmedAddress.startsWith('Q')) {
    return "Address must start with 'Q'";
  }

  if (trimmedAddress.length < format.totalLen) {
    return `Address is too short (${trimmedAddress.length}/${format.totalLen} characters)`;
  }

  if (trimmedAddress.length > format.totalLen) {
    return `Address is too long (${trimmedAddress.length}/${format.totalLen} characters)`;
  }

  const hexPart = trimmedAddress.slice(1);
  if (!/^[0-9a-fA-F]+$/.test(hexPart)) {
    return "Address contains invalid characters (only 0-9, a-f, A-F allowed after 'Q')";
  }

  return 'Invalid address format';
};
