/**
 * Locks the typed-data scheme vectors in canonical.json: the scheme each
 * payload selects, its hashes and digest, and deterministic signatures.
 * The SDK and the extension assert the same file byte for byte. The
 * connect SDK's scripts/typed-data-reference.py, which shares no code with
 * this codec, recomputes every digest, and typedDataSlots.test.ts checks
 * single slots byte by byte.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  bytesToHex,
  computeTypedDataDigest,
  encodeType,
  hashStruct,
  signTypedData,
  typeHash,
  typedDataSchemeVersion,
  verifyTypedData,
  type TypedDataPayload,
  type TypedDataSchemeVersion,
} from "..";

interface SchemeVector {
  label: string;
  schemeVersion: TypedDataSchemeVersion;
  payload: TypedDataPayload;
  encodeTypeString: string;
  typeHashHex: string;
  domainHashHex: string;
  messageHashHex: string;
  digestHex: string;
}

interface SchemeSigningVector {
  label: string;
  hexSeed: string;
  payload: TypedDataPayload;
  schemeVersion: TypedDataSchemeVersion;
  signature: string;
  publicKey: string;
  descriptor: string;
  signer: string;
  digest: string;
}

interface Canonical {
  schemeVersionTypedV2: "QRL-SIGN-TYPED-v2";
  schemeVectors: SchemeVector[];
  schemeSigningVectors: SchemeSigningVector[];
}

const canonical: Canonical = JSON.parse(
  readFileSync(
    join(__dirname, "..", "__fixtures__", "canonical.json"),
    "utf-8",
  ),
);

describe("typed-data scheme vectors", () => {
  it("covers both schemes", () => {
    const schemes = new Set(
      canonical.schemeVectors.map((v) => v.schemeVersion),
    );
    expect(schemes).toEqual(
      new Set(["QRL-SIGN-TYPED-v1", "QRL-SIGN-TYPED-v2"]),
    );
    expect(canonical.schemeVersionTypedV2).toBe("QRL-SIGN-TYPED-v2");
  });

  it.each(canonical.schemeVectors.map((v) => [v.label, v] as const))(
    "%s: scheme, hashes and digest match",
    (_label, v) => {
      const { payload, schemeVersion } = v;
      expect(typedDataSchemeVersion(payload)).toBe(schemeVersion);
      expect(encodeType(payload.primaryType, payload.types)).toBe(
        v.encodeTypeString,
      );
      expect(bytesToHex(typeHash(payload.primaryType, payload.types))).toBe(
        v.typeHashHex,
      );
      expect(
        bytesToHex(
          hashStruct("QRLDomain", payload.domain, payload.types, schemeVersion),
        ),
      ).toBe(v.domainHashHex);
      expect(
        bytesToHex(
          hashStruct(
            payload.primaryType,
            payload.message,
            payload.types,
            schemeVersion,
          ),
        ),
      ).toBe(v.messageHashHex);
      expect(bytesToHex(computeTypedDataDigest(payload))).toBe(v.digestHex);
    },
  );

  it.each(canonical.schemeSigningVectors.map((v) => [v.label, v] as const))(
    "%s: deterministic signature reproduces byte for byte and verifies",
    (_label, v) => {
      const signed = signTypedData(v.payload, v.hexSeed, { randomized: false });
      expect(signed).toEqual({
        signature: v.signature,
        publicKey: v.publicKey,
        signer: v.signer,
        descriptor: v.descriptor,
        digest: v.digest,
        schemeVersion: v.schemeVersion,
        domain: v.payload.domain,
      });
      expect(verifyTypedData({ ...signed, payload: v.payload })).toBe(true);
    },
  );

  it("rejects a response that claims the other scheme", () => {
    for (const v of canonical.schemeSigningVectors) {
      const other =
        v.schemeVersion === "QRL-SIGN-TYPED-v2"
          ? "QRL-SIGN-TYPED-v1"
          : "QRL-SIGN-TYPED-v2";
      expect(
        verifyTypedData({
          signature: v.signature,
          publicKey: v.publicKey,
          payload: v.payload,
          schemeVersion: other,
        }),
      ).toBe(false);
    }
  });
});
