import {
  isValidQrlAddress,
  QRL_ADDRESS_PATTERN,
} from "@/utils/web3/address";

export const Q_ADDRESS_PATTERN = QRL_ADDRESS_PATTERN;

export function isQrlAccount(candidate: unknown): candidate is string {
  return isValidQrlAddress(candidate);
}

/** QRL Connect account authorization is a byte-for-byte string binding. */
export function isExactQrlAccount(
  candidate: unknown,
  expected: unknown,
): candidate is string {
  return (
    typeof candidate === "string" &&
    typeof expected === "string" &&
    isQrlAccount(candidate) &&
    isQrlAccount(expected) &&
    candidate === expected
  );
}
