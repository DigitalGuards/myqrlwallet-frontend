import { isValidQrlAddress } from "@/utils/web3/address";

const ADDRESS_FINGERPRINT_SEGMENT_LENGTH = 8;
const ADDRESS_GROUP_LENGTH = 8;
/** Reveal grouping shared with the browser extension's full-address view. */
export const ADDRESS_DISCLOSURE_GROUP_LENGTH = 5;
const LEGACY_QRL_ADDRESS_PATTERN = /^[QZ][0-9a-fA-F]{40}$/;
const EMBEDDED_QRL_ADDRESS_PATTERN =
  /(^|[^0-9a-fA-F])(Q[0-9a-fA-F]{128}|[QZ][0-9a-fA-F]{40})(?=$|[^0-9a-fA-F])/g;

function isDisplayableQrlAddress(address: string): boolean {
  return isValidQrlAddress(address) || LEGACY_QRL_ADDRESS_PATTERN.test(address);
}

function splitQrlPrefix(address: string): { prefix: string; payload: string } {
  return { prefix: address.charAt(0), payload: address.slice(1) };
}

/**
 * Produces a compact address fingerprint sampled from the beginning, centre,
 * and end of the complete address payload. Checksum casing is preserved.
 */
export const formatAddressFingerprint = (address: string): string => {
  if (!isDisplayableQrlAddress(address)) return address;

  const { prefix, payload } = splitQrlPrefix(address);
  const middleStart = Math.floor(
    (payload.length - ADDRESS_FINGERPRINT_SEGMENT_LENGTH) / 2,
  );

  return [
    `${prefix}${payload.slice(0, ADDRESS_FINGERPRINT_SEGMENT_LENGTH)}`,
    payload.slice(
      middleStart,
      middleStart + ADDRESS_FINGERPRINT_SEGMENT_LENGTH,
    ),
    payload.slice(-ADDRESS_FINGERPRINT_SEGMENT_LENGTH),
  ].join("...");
};

/** Keeps only the start and end for narrow address columns. */
export const formatAddressEnds = (address: string): string => {
  if (!isDisplayableQrlAddress(address)) return address;
  const { prefix, payload } = splitQrlPrefix(address);
  return `${prefix}${payload.slice(0, ADDRESS_FINGERPRINT_SEGMENT_LENGTH)}...${payload.slice(-ADDRESS_FINGERPRINT_SEGMENT_LENGTH)}`;
};

/** Formats the complete address into readable groups that can wrap safely. */
export const formatAddress = (
  address: string,
  groupSize: number = ADDRESS_GROUP_LENGTH,
): string => {
  if (!isDisplayableQrlAddress(address)) return address;
  if (!Number.isInteger(groupSize) || groupSize <= 0) return address;

  const { prefix, payload } = splitQrlPrefix(address);
  const groups: string[] = [];
  for (let index = 0; index < payload.length; index += groupSize) {
    groups.push(payload.slice(index, index + groupSize));
  }

  if (groups.length === 0) return prefix;
  groups[0] = `${prefix}${groups[0]}`;
  return groups.join(" ");
};

/**
 * Splits an address into its prefix and fixed-length body groups. Mirrors the
 * browser extension's grouping so the wallet surfaces read identically. The
 * raw value is never altered, only how it is chunked for display.
 */
export const splitAddressGroups = (
  address: string,
  groupSize: number = ADDRESS_DISCLOSURE_GROUP_LENGTH,
): { prefix: string; groups: string[] } => {
  if (!isDisplayableQrlAddress(address)) return { prefix: "", groups: [address] };
  if (!Number.isInteger(groupSize) || groupSize <= 0)
    return { prefix: "", groups: [address] };

  const { prefix, payload } = splitQrlPrefix(address);
  const groups: string[] = [];
  for (let index = 0; index < payload.length; index += groupSize) {
    groups.push(payload.slice(index, index + groupSize));
  }

  return { prefix, groups };
};

/** Compatibility alias for existing compact-address call sites. */
export const formatAddressShort = (address: string): string =>
  formatAddressFingerprint(address);

/** Compacts valid QRL addresses embedded in labels such as wallet filenames. */
export const formatAddressFingerprintsInText = (value: string): string =>
  value.replace(
    EMBEDDED_QRL_ADDRESS_PATTERN,
    (match, leading: string, address: string) => {
      const fingerprint = formatAddressFingerprint(address);
      return fingerprint === address ? match : `${leading}${fingerprint}`;
    },
  );
