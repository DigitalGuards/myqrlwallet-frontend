export const Q_ADDRESS_PATTERN = /^Q[0-9a-fA-F]{40}$/;

/** QRL Connect account authorization is a byte-for-byte string binding. */
export function isExactQrlAccount(
  candidate: unknown,
  expected: unknown,
): candidate is string {
  return (
    typeof candidate === "string" &&
    typeof expected === "string" &&
    Q_ADDRESS_PATTERN.test(candidate) &&
    Q_ADDRESS_PATTERN.test(expected) &&
    candidate === expected
  );
}
