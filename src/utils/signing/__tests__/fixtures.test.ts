/**
 * Cross-repo parity fixtures.
 *
 * These pin the exact `encodeType` strings and SHAKE256 digests our encoders
 * produce for a fixed set of inputs. The SDK keeps a byte-identical copy of
 * `__fixtures__/canonical.json`; any drift between the two repos breaks both
 * test suites on the next PR.
 *
 * Signing fixtures additionally pin one deterministic-mode signature (the
 * digest is enough to verify cross-repo encoding, but the signature locks in
 * the keypair derivation + ctx wiring).
 *
 * If you intentionally change the spec, regenerate `canonical.json` with
 * `npx jest -t "regenerate fixtures"` (a manual flow described in
 * docs/POST-QUANTUM-SIGNING-PLAN.md) and bump SCHEME_VERSION_*.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  bytesToHex,
  computeMessageDigest,
  computeTypedDataDigest,
  encodeType,
  hashStruct,
  hexToBytes,
  signMessage,
  signTypedData,
  typeHash,
  verifyMessage,
  verifyTypedData,
} from '..';
import type { TypedDataPayload } from '..';

interface MessageVector {
  label: string;
  messageHex: string;
  digestHex: string;
}

interface TypedVector {
  label: string;
  payload: TypedDataPayload;
  encodeTypeString: string;
  typeHashHex: string;
  domainHashHex: string;
  messageHashHex: string;
  digestHex: string;
}

interface SigningVector {
  label: string;
  hexSeed: string;
  messageHex?: string;
  payload?: TypedDataPayload;
  signature: string;
  publicKey: string;
  signer: string;
  digest: string;
}

interface Canonical {
  schemeVersionMsg: 'QRL-SIGN-MSG-v1';
  schemeVersionTyped: 'QRL-SIGN-TYPED-v1';
  messageVectors: MessageVector[];
  typedVectors: TypedVector[];
  signingVectors: SigningVector[];
}

const CANONICAL_PATH = join(__dirname, '..', '__fixtures__', 'canonical.json');

describe('canonical fixtures', () => {
  const canonical: Canonical = JSON.parse(readFileSync(CANONICAL_PATH, 'utf-8'));

  it('messageDigest agrees with every locked vector', () => {
    expect(canonical.messageVectors.length).toBeGreaterThan(0);
    for (const v of canonical.messageVectors) {
      const got = bytesToHex(computeMessageDigest(hexToBytes(v.messageHex)));
      expect({ label: v.label, digest: got }).toEqual({
        label: v.label,
        digest: v.digestHex,
      });
    }
  });

  it('typedData encoder agrees with every locked vector', () => {
    expect(canonical.typedVectors.length).toBeGreaterThan(0);
    for (const v of canonical.typedVectors) {
      expect({ label: v.label, encoded: encodeType(v.payload.primaryType, v.payload.types) })
        .toEqual({ label: v.label, encoded: v.encodeTypeString });

      const th = bytesToHex(typeHash(v.payload.primaryType, v.payload.types));
      expect({ label: v.label, typeHash: th }).toEqual({
        label: v.label,
        typeHash: v.typeHashHex,
      });

      const dh = bytesToHex(hashStruct('QRLDomain', v.payload.domain, v.payload.types));
      expect({ label: v.label, domainHash: dh }).toEqual({
        label: v.label,
        domainHash: v.domainHashHex,
      });

      const mh = bytesToHex(hashStruct(v.payload.primaryType, v.payload.message, v.payload.types));
      expect({ label: v.label, messageHash: mh }).toEqual({
        label: v.label,
        messageHash: v.messageHashHex,
      });

      const final = bytesToHex(computeTypedDataDigest(v.payload));
      expect({ label: v.label, digest: final }).toEqual({
        label: v.label,
        digest: v.digestHex,
      });
    }
  });

  it('deterministic signing vector reproduces locked signature byte-for-byte', () => {
    for (const v of canonical.signingVectors) {
      if (v.messageHex !== undefined) {
        const got = signMessage(v.messageHex, v.hexSeed, { randomized: false });
        expect({ label: v.label, ...got, schemeVersion: undefined }).toEqual({
          label: v.label,
          signature: v.signature,
          publicKey: v.publicKey,
          signer: v.signer,
          digest: v.digest,
          schemeVersion: undefined,
        });
        expect(verifyMessage({
          signature: got.signature,
          publicKey: got.publicKey,
          messageBytes: v.messageHex,
        })).toBe(true);
      } else if (v.payload) {
        const got = signTypedData(v.payload, v.hexSeed, { randomized: false });
        expect({ label: v.label, signature: got.signature, publicKey: got.publicKey, signer: got.signer, digest: got.digest })
          .toEqual({
            label: v.label,
            signature: v.signature,
            publicKey: v.publicKey,
            signer: v.signer,
            digest: v.digest,
          });
        expect(verifyTypedData({
          signature: got.signature,
          publicKey: got.publicKey,
          payload: v.payload,
        })).toBe(true);
      }
    }
  });
});
