/**
 * Byte-level checks of single atomic slots, written out by hand from the
 * scheme definition so they do not depend on the codec under test. v1 slots
 * are 32 bytes, v2 slots 64 bytes (one QRVM word). Mirrors the connect SDK's
 * test/typedDataSlots.test.ts.
 */

import { bytesToHex } from "../bytes";
import { SCHEME_VERSION_TYPED, SCHEME_VERSION_TYPED_V2 } from "../ctx";
import { encodeField, hashStruct } from "../typedData";

const V1 = SCHEME_VERSION_TYPED;
const V2 = SCHEME_VERSION_TYPED_V2;
// encodeField validates the type map; the field type under test is passed directly.
const TYPES = { T: [{ name: "x", type: "uint8" }] };
const UINT256_MAX =
  "115792089237316195423570985008687907853269984665640564039457584007913129639935";

const cases: [type: string, value: unknown, v1: string | null, v2: string][] = [
  ["int8", "-128", "ff".repeat(31) + "80", "ff".repeat(63) + "80"],
  ["int256", "-1", "ff".repeat(32), "ff".repeat(64)],
  ["int64", "5", "00".repeat(31) + "05", "00".repeat(63) + "05"],
  ["uint8", "255", "00".repeat(31) + "ff", "00".repeat(63) + "ff"],
  ["uint256", UINT256_MAX, "ff".repeat(32), "00".repeat(32) + "ff".repeat(32)],
  ["bool", true, "00".repeat(31) + "01", "00".repeat(63) + "01"],
  ["bool", false, "00".repeat(32), "00".repeat(64)],
  [
    "bytes4",
    "0xdeadbeef",
    "deadbeef" + "00".repeat(28),
    "deadbeef" + "00".repeat(60),
  ],
  [
    "bytes32",
    "0x" + "9e".repeat(32),
    "9e".repeat(32),
    "9e".repeat(32) + "00".repeat(32),
  ],
  // A 64-byte QIP-55 address fills a v2 slot and has no v1 encoding.
  ["address", `Q${"1".repeat(128)}`, null, "11".repeat(64)],
];

describe("typed-data atomic slots", () => {
  it.each(cases)("%s %s", (type, value, v1, v2) => {
    expect(bytesToHex(encodeField(type, value, TYPES, V2))).toBe(`0x${v2}`);
    if (v1 === null) {
      expect(() => encodeField(type, value, TYPES, V1)).toThrow(
        "qrl_signTypedData v1 does not support QIP-55 address fields",
      );
    } else {
      expect(bytesToHex(encodeField(type, value, TYPES, V1))).toBe(`0x${v1}`);
    }
  });

  it("defaults to the scheme the type map selects", () => {
    const withAddress = {
      QRLDomain: [{ name: "verifyingContract", type: "address" }],
      Vote: [{ name: "proposal", type: "uint32" }],
    };
    const addressFree = { Vote: [{ name: "proposal", type: "uint32" }] };
    const vote = { proposal: "12" };
    expect(hashStruct("Vote", vote, withAddress)).toEqual(
      hashStruct("Vote", vote, withAddress, V2),
    );
    expect(hashStruct("Vote", vote, addressFree)).toEqual(
      hashStruct("Vote", vote, addressFree, V1),
    );
    expect(hashStruct("Vote", vote, withAddress)).not.toEqual(
      hashStruct("Vote", vote, addressFree),
    );
  });
});
