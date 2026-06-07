/**
 * End-to-end tests for the post-quantum signing module.
 *
 * Generates an ephemeral ML-DSA-87 wallet so the suite is self-contained
 * (no checked-in seed). The cross-repo parity tests load a pinned fixture
 * separately, in `fixtures.test.ts`.
 */

import { MLDSA87, newWalletFromExtendedSeed } from '@theqrl/wallet.js';
import { utils as web3Utils } from '@theqrl/web3';
import {
  computeMessageDigest,
  computeTypedDataDigest,
  encodeType,
  signMessage,
  signTypedData,
  verifyMessage,
  verifyTypedData,
  bytesToHex,
  hexToBytes,
  SCHEME_VERSION_MSG,
  SCHEME_VERSION_TYPED,
  type TypedDataPayload,
} from '..';

function newEphemeralSeed(): string {
  const wallet = MLDSA87.newWallet();
  const hex = wallet.getHexExtendedSeed();
  wallet.zeroize();
  return hex;
}

const TYPED_PAYLOAD = (signer: string): TypedDataPayload => ({
  types: {
    QRLDomain: [{ name: 'name', type: 'string' }],
    LoginChallenge: [
      { name: 'account', type: 'address' },
      { name: 'nonce', type: 'bytes32' },
      { name: 'issuedAt', type: 'uint64' },
    ],
  },
  primaryType: 'LoginChallenge',
  domain: { name: 'zondscan.com' },
  message: {
    account: signer,
    nonce: '0x' + 'ab'.repeat(32),
    issuedAt: '1747699200',
  },
});

describe('computeMessageDigest', () => {
  it('produces a 64-byte digest', () => {
    const digest = computeMessageDigest(new Uint8Array([0x48, 0x69]));
    expect(digest).toBeInstanceOf(Uint8Array);
    expect(digest.length).toBe(64);
  });

  it('is deterministic for the same input', () => {
    const a = computeMessageDigest(new Uint8Array([1, 2, 3]));
    const b = computeMessageDigest(new Uint8Array([1, 2, 3]));
    expect(bytesToHex(a)).toBe(bytesToHex(b));
  });

  it('changes if a single byte changes', () => {
    const a = computeMessageDigest(new Uint8Array([1, 2, 3]));
    const b = computeMessageDigest(new Uint8Array([1, 2, 4]));
    expect(bytesToHex(a)).not.toBe(bytesToHex(b));
  });

  it('produces different digests for empty vs 1-byte input', () => {
    const a = computeMessageDigest(new Uint8Array());
    const b = computeMessageDigest(new Uint8Array([0]));
    expect(bytesToHex(a)).not.toBe(bytesToHex(b));
  });
});

describe('signMessage / verifyMessage round-trip', () => {
  it('signs random bytes and verifies them', () => {
    const seed = newEphemeralSeed();
    const result = signMessage('0x48656c6c6f', seed, { randomized: false });

    expect(result.schemeVersion).toBe(SCHEME_VERSION_MSG);
    expect(result.signature.startsWith('0x')).toBe(true);
    expect(result.publicKey.startsWith('0x')).toBe(true);
    expect(result.digest.startsWith('0x')).toBe(true);
    expect(result.signer.startsWith('Q')).toBe(true);

    const ok = verifyMessage({
      signature: result.signature,
      publicKey: result.publicKey,
      messageBytes: '0x48656c6c6f',
    });
    expect(ok).toBe(true);
  });

  it('verify fails if the message changes', () => {
    const seed = newEphemeralSeed();
    const result = signMessage('0x48656c6c6f', seed, { randomized: false });

    const ok = verifyMessage({
      signature: result.signature,
      publicKey: result.publicKey,
      messageBytes: '0x48656c6c70',
    });
    expect(ok).toBe(false);
  });

  it('verify fails if the signature is tampered', () => {
    const seed = newEphemeralSeed();
    const result = signMessage('0xdeadbeef', seed, { randomized: false });

    const sigBytes = hexToBytes(result.signature);
    sigBytes[0] = (sigBytes[0] ?? 0) ^ 0x01;
    const ok = verifyMessage({
      signature: sigBytes,
      publicKey: result.publicKey,
      messageBytes: '0xdeadbeef',
    });
    expect(ok).toBe(false);
  });

  it('handles empty message bytes', () => {
    const seed = newEphemeralSeed();
    const result = signMessage('0x', seed, { randomized: false });
    expect(result.digest.length).toBe(2 + 64 * 2);
    expect(verifyMessage({
      signature: result.signature,
      publicKey: result.publicKey,
      messageBytes: '0x',
    })).toBe(true);
  });
});

describe('encodeType', () => {
  it('emits canonical form for a flat struct', () => {
    const types = {
      QRLDomain: [{ name: 'name', type: 'string' }],
      LoginChallenge: [
        { name: 'account', type: 'address' },
        { name: 'nonce', type: 'bytes32' },
      ],
    };
    expect(encodeType('LoginChallenge', types)).toBe(
      'LoginChallenge(address account,bytes32 nonce)',
    );
  });

  it('sorts referenced structs alphabetically after primary', () => {
    const types = {
      QRLDomain: [{ name: 'name', type: 'string' }],
      Order: [
        { name: 'maker', type: 'Maker' },
        { name: 'taker', type: 'Taker' },
      ],
      Maker: [{ name: 'addr', type: 'address' }],
      Taker: [{ name: 'addr', type: 'address' }],
    };
    expect(encodeType('Order', types)).toBe(
      'Order(Maker maker,Taker taker)Maker(address addr)Taker(address addr)',
    );
  });

  it('rejects cyclic types', () => {
    const types = {
      QRLDomain: [{ name: 'name', type: 'string' }],
      Loop: [{ name: 'self', type: 'Loop' }],
    };
    expect(() => encodeType('Loop', types)).toThrow(/cyclic/i);
  });
});

describe('computeTypedDataDigest validation', () => {
  it('rejects QRLDomain.name missing', () => {
    const seed = newEphemeralSeed();
    const wallet = newWalletFromExtendedSeed(seed);
    const signer = web3Utils.toChecksumAddress(`Q${wallet.getAddressStr().slice(1, 41)}`);
    wallet.zeroize();
    const bad: TypedDataPayload = {
      types: {
        QRLDomain: [{ name: 'version', type: 'string' }],
        LoginChallenge: [{ name: 'account', type: 'address' }],
      },
      primaryType: 'LoginChallenge',
      domain: { version: '1' },
      message: { account: signer },
    };
    expect(() => computeTypedDataDigest(bad)).toThrow(/QRLDomain\.name/);
  });

  it('rejects QRLDomain fields outside the reserved whitelist', () => {
    const bad: TypedDataPayload = {
      types: {
        QRLDomain: [
          { name: 'name', type: 'string' },
          { name: 'custom', type: 'string' },
        ],
        LoginChallenge: [{ name: 'account', type: 'address' }],
      },
      primaryType: 'LoginChallenge',
      domain: { name: 'x', custom: 'y' },
      message: { account: 'Q' + '0'.repeat(40) },
    };
    expect(() => computeTypedDataDigest(bad)).toThrow(/reserved set/);
  });

  it('rejects QRLDomain.chainId with a wrong type', () => {
    const bad: TypedDataPayload = {
      types: {
        QRLDomain: [
          { name: 'name', type: 'string' },
          { name: 'chainId', type: 'uint64' },
        ],
        LoginChallenge: [{ name: 'account', type: 'address' }],
      },
      primaryType: 'LoginChallenge',
      domain: { name: 'x', chainId: '1' },
      message: { account: 'Q' + '0'.repeat(40) },
    };
    expect(() => computeTypedDataDigest(bad)).toThrow(/chainId.*uint256/);
  });

  it('rejects unused referenced types', () => {
    const bad: TypedDataPayload = {
      types: {
        QRLDomain: [{ name: 'name', type: 'string' }],
        LoginChallenge: [{ name: 'account', type: 'address' }],
        Orphan: [{ name: 'x', type: 'uint8' }],
      },
      primaryType: 'LoginChallenge',
      domain: { name: 'x' },
      message: { account: 'Q' + '0'.repeat(40) },
    };
    expect(() => computeTypedDataDigest(bad)).toThrow(/unused/);
  });

  it('rejects bytes33 as an unknown atomic', () => {
    const bad: TypedDataPayload = {
      types: {
        QRLDomain: [{ name: 'name', type: 'string' }],
        Foo: [{ name: 'x', type: 'bytes33' }],
      },
      primaryType: 'Foo',
      domain: { name: 'x' },
      message: { x: '0x' + '00'.repeat(33) },
    };
    expect(() => computeTypedDataDigest(bad)).toThrow(/bytesN width/);
  });
});

describe('signTypedData / verifyTypedData round-trip', () => {
  it('signs LoginChallenge and verifies', () => {
    const seed = newEphemeralSeed();
    const wallet = newWalletFromExtendedSeed(seed);
    const signer = web3Utils.toChecksumAddress(`Q${wallet.getAddressStr().slice(1, 41)}`);
    wallet.zeroize();

    const payload = TYPED_PAYLOAD(signer);
    const result = signTypedData(payload, seed, { randomized: false });

    expect(result.schemeVersion).toBe(SCHEME_VERSION_TYPED);
    expect(result.signer).toBe(signer);
    expect(result.domain).toEqual({ name: 'zondscan.com' });

    expect(verifyTypedData({
      signature: result.signature,
      publicKey: result.publicKey,
      payload,
    })).toBe(true);
  });

  it('verify fails if the message changes', () => {
    const seed = newEphemeralSeed();
    const wallet = newWalletFromExtendedSeed(seed);
    const signer = web3Utils.toChecksumAddress(`Q${wallet.getAddressStr().slice(1, 41)}`);
    wallet.zeroize();

    const payload = TYPED_PAYLOAD(signer);
    const result = signTypedData(payload, seed, { randomized: false });

    const tampered = TYPED_PAYLOAD(signer);
    tampered.message['issuedAt'] = '1747699201';

    expect(verifyTypedData({
      signature: result.signature,
      publicKey: result.publicKey,
      payload: tampered,
    })).toBe(false);
  });

  it('verify fails if the domain changes', () => {
    const seed = newEphemeralSeed();
    const wallet = newWalletFromExtendedSeed(seed);
    const signer = web3Utils.toChecksumAddress(`Q${wallet.getAddressStr().slice(1, 41)}`);
    wallet.zeroize();

    const payload = TYPED_PAYLOAD(signer);
    const result = signTypedData(payload, seed, { randomized: false });

    const tampered = TYPED_PAYLOAD(signer);
    tampered.domain = { name: 'evil.example' };

    expect(verifyTypedData({
      signature: result.signature,
      publicKey: result.publicKey,
      payload: tampered,
    })).toBe(false);
  });
});

describe('randomized signing produces fresh sig per call', () => {
  it('two calls with randomized=true differ in signature, agree on digest', () => {
    const seed = newEphemeralSeed();
    const a = signMessage('0xdeadbeef', seed, { randomized: true });
    const b = signMessage('0xdeadbeef', seed, { randomized: true });
    expect(a.digest).toBe(b.digest);
    expect(a.signature).not.toBe(b.signature);
    expect(verifyMessage({ signature: a.signature, publicKey: a.publicKey, messageBytes: '0xdeadbeef' })).toBe(true);
    expect(verifyMessage({ signature: b.signature, publicKey: b.publicKey, messageBytes: '0xdeadbeef' })).toBe(true);
  });
});
