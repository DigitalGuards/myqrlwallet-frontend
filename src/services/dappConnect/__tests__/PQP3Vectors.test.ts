import { describe, expect, it } from "@jest/globals";
import {
  deriveAeadKey,
  exportRawAeadKey,
  transcriptHash,
} from "../PQCrypto";
import { computeFingerprint } from "../qrUri";

const FP_HEX =
  "d5419e406f0d0defcd4d9b756bc51b22cde8650d216041b17ab328c0a9b04836";
const HTX_HEX =
  "c45ed29377570dfbfac06061ee0e72230938fba033b5525d9065deedb7bacc02";
const KEY_HEX =
  "5a85b6146f69c7f9f3188fff69839776593736de6c8f59ae67f791c81b0871b0";

function toHex(value: Uint8Array): string {
  return Array.from(value, (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
}

function protocolVector(): {
  cid: Uint8Array;
  pk: Uint8Array;
  ct: Uint8Array;
  cap: Uint8Array;
  ss: Uint8Array;
} {
  return {
    cid: Uint8Array.from({ length: 16 }, (_, index) => index),
    pk: Uint8Array.from({ length: 1184 }, (_, index) => index & 0xff),
    ct: Uint8Array.from(
      { length: 1088 },
      (_, index) => (255 - index) & 0xff,
    ),
    cap: Uint8Array.from({ length: 32 }, (_, index) => 0xa0 + index),
    ss: Uint8Array.from({ length: 32 }, (_, index) => index),
  };
}

describe("PQP3 cross-repository vectors", () => {
  it("pins fp = SHA-256(label || cid || pk || cap)", async () => {
    const { cid, pk, cap } = protocolVector();

    expect(toHex(await computeFingerprint(cid, pk, cap))).toBe(FP_HEX);
  });

  it("pins htx and the capability-salted HKDF output", async () => {
    const { cid, pk, ct, cap, ss } = protocolVector();
    const htx = await transcriptHash(cid, pk, ct, cap);
    const key = await deriveAeadKey(ss, htx, cap);

    expect(toHex(htx)).toBe(HTX_HEX);
    expect(toHex(await exportRawAeadKey(key))).toBe(KEY_HEX);
  });

  it("rejects a capability of any non-exact length", async () => {
    const { cid, pk, ct, ss } = protocolVector();
    const shortCap = new Uint8Array(31);

    await expect(transcriptHash(cid, pk, ct, shortCap)).rejects.toThrow(
      "capability must be 32 bytes",
    );
    await expect(
      deriveAeadKey(ss, new Uint8Array(32), shortCap),
    ).rejects.toThrow("capability must be 32 bytes");
  });
});
