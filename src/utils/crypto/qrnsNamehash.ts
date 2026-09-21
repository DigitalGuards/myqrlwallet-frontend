import { keccak_256 } from "@noble/hashes/sha3.js";

const EMPTY_NODE = new Uint8Array(32);
const QNS_LABEL_PATTERN = /^[a-z0-9-]+$/;
const QRNS_RECIPIENT_SUFFIX = ".qrl";

export class QrnsNameError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "QrnsNameError";
  }
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
}

function concatBytes(left: Uint8Array, right: Uint8Array): Uint8Array {
  const result = new Uint8Array(left.length + right.length);
  result.set(left, 0);
  result.set(right, left.length);
  return result;
}

function asciiBytes(value: string): Uint8Array {
  const result = new Uint8Array(value.length);
  for (let index = 0; index < value.length; index += 1) {
    const codePoint = value.charCodeAt(index);
    if (codePoint > 0x7f) {
      throw new QrnsNameError("QNS hashing accepts only ASCII input");
    }
    result[index] = codePoint;
  }
  return result;
}

/**
 * Apply the conservative ASCII QNS profile used by the current QNS SDK.
 * Unicode and ambiguous reserved labels fail closed until full normalization
 * support is shared by every QNS client.
 */
export function normalizeQrnsName(name: string): string {
  if (name === "") return "";

  let lowered = "";
  for (const character of name) {
    const codePoint = character.codePointAt(0);
    if (codePoint === undefined) {
      throw new QrnsNameError("Invalid QNS character");
    }
    lowered +=
      codePoint >= 0x41 && codePoint <= 0x5a
        ? String.fromCharCode(codePoint + 32)
        : character;
  }

  for (const label of lowered.split(".")) {
    if (label === "") {
      throw new QrnsNameError(`Empty label in "${name}"`);
    }
    if (!QNS_LABEL_PATTERN.test(label)) {
      throw new QrnsNameError(
        "QNS names may contain only ASCII letters, digits, hyphens, and dots",
      );
    }
    if (/^..--/.test(label)) {
      throw new QrnsNameError(`Reserved double-hyphen label in "${name}"`);
    }
  }

  return lowered;
}

/** Normalize a wallet recipient name and require the canonical QRNS suffix. */
export function normalizeQrnsRecipientName(name: string): string {
  const normalizedName = normalizeQrnsName(name);
  if (!normalizedName.endsWith(QRNS_RECIPIENT_SUFFIX)) {
    throw new QrnsNameError("QRNS recipient names must end in .qrl.");
  }
  return normalizedName;
}

/** Return the EIP-137 namehash as lowercase 0x-prefixed bytes32 hex. */
export function qrnsNamehashHex(normalizedName: string): string {
  if (normalizedName === "") return `0x${"0".repeat(64)}`;

  const labels = normalizedName.split(".");
  let node = EMPTY_NODE;
  for (let index = labels.length - 1; index >= 0; index -= 1) {
    const label = labels[index];
    if (label === undefined) {
      throw new QrnsNameError("Invalid QNS label");
    }
    node = keccak_256(concatBytes(node, keccak_256(asciiBytes(label))));
  }
  return `0x${bytesToHex(node)}`;
}

/** Return the first four Keccak-256 bytes of one ABI function signature. */
export function qrnsFunctionSelector(signature: string): string {
  return `0x${bytesToHex(keccak_256(asciiBytes(signature)).slice(0, 4))}`;
}
