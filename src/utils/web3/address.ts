/**
 * Address validation utilities for QRL blockchain addresses
 *
 * QRL addresses follow the format: Q + 40 hexadecimal characters (total 41 chars)
 * Example: Q20b4fb2929cfBe8b002b8A0c572551F755e54aEF
 */

/**
 * Validates if a string is a properly formatted QRL address
 * @param address - The address string to validate
 * @returns boolean - True if address is valid, false otherwise
 */
export const isValidQrlAddress = (address: string): boolean => {
  if (!address || typeof address !== 'string') {
    return false;
  }

  // Trim any whitespace
  const trimmedAddress = address.trim();

  // Check basic format: must start with 'Q' and be 41 characters total
  // (Q + 40 hex chars)
  if (!trimmedAddress.startsWith('Q')) {
    return false;
  }

  if (trimmedAddress.length !== 41) {
    return false;
  }

  // Check that characters after 'Q' are valid hexadecimal
  const hexPart = trimmedAddress.slice(1);
  const hexRegex = /^[0-9a-fA-F]{40}$/;

  if (!hexRegex.test(hexPart)) {
    return false;
  }

  return true;
};

/**
 * Validates and normalizes a QRL address
 * @param address - The address string to validate and normalize
 * @returns string | null - Normalized address or null if invalid
 */
export const normalizeQrlAddress = (address: string): string | null => {
  if (!isValidQrlAddress(address)) {
    return null;
  }

  // Return the address with 'Q' and lowercase hex
  const trimmedAddress = address.trim();
  return 'Q' + trimmedAddress.slice(1).toLowerCase();
};

/**
 * Gets a user-friendly error message for invalid addresses
 * @param address - The address that failed validation
 * @returns string - Error message explaining the issue
 */
export const getAddressValidationError = (address: string): string => {
  if (!address || address.trim().length === 0) {
    return "Address is required";
  }

  const trimmedAddress = address.trim();

  if (!trimmedAddress.startsWith('Q')) {
    return "Address must start with 'Q'";
  }

  if (trimmedAddress.length < 41) {
    return `Address is too short (${trimmedAddress.length}/41 characters)`;
  }

  if (trimmedAddress.length > 41) {
    return `Address is too long (${trimmedAddress.length}/41 characters)`;
  }

  const hexPart = trimmedAddress.slice(1);
  if (!/^[0-9a-fA-F]+$/.test(hexPart)) {
    return "Address contains invalid characters (only 0-9, a-f, A-F allowed after 'Q')";
  }

  return "Invalid address format";
};
