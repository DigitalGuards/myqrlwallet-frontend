import {
  checksumWalletQrlAddress,
  isValidWalletQrlAddress,
} from '@/utils/crypto/qrlAddress';

export const QRL_ADDRESS_HEX_LENGTH = 128;
export const QRL_ADDRESS_LENGTH = QRL_ADDRESS_HEX_LENGTH + 1;
export const QRL_ADDRESS_PATTERN = /^Q[0-9a-fA-F]{128}$/;
export const QRL_ZERO_ADDRESS = `Q${'0'.repeat(QRL_ADDRESS_HEX_LENGTH)}`;
const VM64_TOPIC_HEX_LENGTH = 128;
const EVENT_SIGNATURE_HEX_LENGTH = 64;

function exactHexBody(value: unknown, expectedLength: number): string | null {
  if (value instanceof Uint8Array) {
    if (value.length * 2 !== expectedLength) return null;
    return Array.from(value, (byte) => byte.toString(16).padStart(2, '0')).join('');
  }
  if (typeof value !== 'string') return null;
  const body = /^0x/i.test(value) ? value.slice(2) : value;
  return body.length === expectedLength && /^[0-9a-fA-F]+$/.test(body)
    ? body.toLowerCase()
    : null;
}

/**
 * Validate a QIP-55 QRL address using wallet.js 6's SHAKE256 checksum rules.
 * Uniform-case bodies are accepted for input. Mixed-case bodies must carry
 * the exact checksum, and the application-level prefix is always uppercase Q.
 */
export const isValidQrlAddress = (address: unknown): address is string => {
  if (typeof address !== 'string') return false;
  return (
    QRL_ADDRESS_PATTERN.test(address) &&
    isValidWalletQrlAddress(address)
  );
};

/** Return the canonical QIP-55 SHAKE256 checksum form, or null when invalid. */
export const normalizeQrlAddress = (address: unknown): string | null => {
  if (typeof address !== 'string') return null;
  const trimmedAddress = address.trim();
  if (!isValidQrlAddress(trimmedAddress)) return null;
  try {
    return checksumWalletQrlAddress(trimmedAddress);
  } catch {
    return null;
  }
};

/** Normalize one exact 64-byte QRVM topic to lowercase 0x-hex. */
export const normalizeQrlVm64Topic = (topic: unknown): string | null => {
  const body = exactHexBody(topic, VM64_TOPIC_HEX_LENGTH);
  return body ? `0x${body}` : null;
};

/**
 * Place a 32-byte event-signature hash into a QRVM 64-byte topic. Hyperion and
 * go-qrl use the hash in the high half followed by 32 zero bytes.
 */
export const qrlVm64EventTopicFromHash = (hash: unknown): string | null => {
  const body = exactHexBody(hash, EVENT_SIGNATURE_HEX_LENGTH);
  return body ? `0x${body}${'0'.repeat(EVENT_SIGNATURE_HEX_LENGTH)}` : null;
};

/** Decode one indexed ABI address topic without truncating the 64-byte value. */
export const qrlAddressFromIndexedTopic = (topic: unknown): string | null => {
  const normalizedTopic = normalizeQrlVm64Topic(topic);
  return normalizedTopic
    ? normalizeQrlAddress(`Q${normalizedTopic.slice(2)}`)
    : null;
};

/** Return a user-facing reason why an address failed QIP-55 validation. */
export const getAddressValidationError = (address: string): string => {
  if (!address || address.trim().length === 0) {
    return 'Address is required';
  }

  const trimmedAddress = address.trim();

  if (address !== trimmedAddress) {
    return 'Address must not include surrounding whitespace';
  }

  if (!trimmedAddress.startsWith('Q')) {
    return "Address must start with 'Q'";
  }

  if (trimmedAddress.length < QRL_ADDRESS_LENGTH) {
    return `Address is too short (${trimmedAddress.length}/${QRL_ADDRESS_LENGTH} characters)`;
  }

  if (trimmedAddress.length > QRL_ADDRESS_LENGTH) {
    return `Address is too long (${trimmedAddress.length}/${QRL_ADDRESS_LENGTH} characters)`;
  }

  const hexPart = trimmedAddress.slice(1);
  if (!/^[0-9a-fA-F]+$/.test(hexPart)) {
    return "Address contains invalid characters (only 0-9, a-f, A-F allowed after 'Q')";
  }

  return 'QRL address has an invalid checksum';
};
