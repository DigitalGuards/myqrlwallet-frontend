/**
 * Fixture generator. Filename ends in `.skip.ts` so Jest's `*.test.ts` glob
 * skips it on normal runs. To regenerate `__fixtures__/canonical.json`:
 *
 *   mv generate-fixtures.skip.ts generate-fixtures.test.ts
 *   npx jest --runInBand src/utils/signing/__tests__/generate-fixtures
 *   mv generate-fixtures.test.ts generate-fixtures.skip.ts
 *
 * Bump SCHEME_VERSION_* in ctx.ts when the spec changes; regenerate here
 * and commit the JSON alongside.
 */

import { writeFileSync, mkdirSync } from 'node:fs';
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
  type TypedDataPayload,
} from '..';

const PINNED_SEED =
  '0x0100000580a227e1b6d5a89df7723a71e9c03535e9447ec6d160b68c0ba845c68a05c59226cce711eb3db312c022ccf9577be7';

const LOGIN_CHALLENGE: TypedDataPayload = {
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
    account: 'Q6153d37Fa4DA7193E6219DCBd2bBe62Fa12905b1',
    nonce: '0x' + 'ab'.repeat(32),
    issuedAt: '1747699200',
  },
};

const NESTED_ORDER: TypedDataPayload = {
  types: {
    QRLDomain: [
      { name: 'name', type: 'string' },
      { name: 'chainId', type: 'uint256' },
    ],
    Order: [
      { name: 'maker', type: 'Party' },
      { name: 'taker', type: 'Party' },
      { name: 'amount', type: 'uint256' },
    ],
    Party: [
      { name: 'addr', type: 'address' },
      { name: 'memo', type: 'string' },
    ],
  },
  primaryType: 'Order',
  domain: { name: 'qrl-orders', chainId: '1337' },
  message: {
    maker: { addr: 'Q' + 'aa'.repeat(20), memo: 'maker note' },
    taker: { addr: 'Q' + 'bb'.repeat(20), memo: 'taker note' },
    amount: '0xdeadbeef',
  },
};

const ARRAY_VECTOR: TypedDataPayload = {
  types: {
    QRLDomain: [{ name: 'name', type: 'string' }],
    Mailbox: [
      { name: 'owner', type: 'address' },
      { name: 'tags', type: 'string[]' },
      { name: 'counts', type: 'uint32[3]' },
      { name: 'flag', type: 'bool' },
    ],
  },
  primaryType: 'Mailbox',
  domain: { name: 'mailbox' },
  message: {
    owner: 'Q' + 'cc'.repeat(20),
    tags: ['inbox', 'starred', 'archive'],
    counts: ['1', '2', '3'],
    flag: true,
  },
};

function toMessageVector(label: string, messageHex: string) {
  return {
    label,
    messageHex,
    digestHex: bytesToHex(computeMessageDigest(hexToBytes(messageHex))),
  };
}

function toTypedVector(label: string, payload: TypedDataPayload) {
  return {
    label,
    payload,
    encodeTypeString: encodeType(payload.primaryType, payload.types),
    typeHashHex: bytesToHex(typeHash(payload.primaryType, payload.types)),
    domainHashHex: bytesToHex(hashStruct('QRLDomain', payload.domain, payload.types)),
    messageHashHex: bytesToHex(hashStruct(payload.primaryType, payload.message, payload.types)),
    digestHex: bytesToHex(computeTypedDataDigest(payload)),
  };
}

describe('regenerate fixtures', () => {
  it('writes canonical.json', () => {
    const messageVectors = [
      toMessageVector('empty', '0x'),
      toMessageVector('Hello', '0x48656c6c6f'),
      toMessageVector('32 bytes of 0xab', '0x' + 'ab'.repeat(32)),
      toMessageVector('1 KiB of 0xaa', '0x' + 'aa'.repeat(1024)),
    ];
    const typedVectors = [
      toTypedVector('LoginChallenge', LOGIN_CHALLENGE),
      toTypedVector('Order with nested Party', NESTED_ORDER),
      toTypedVector('Mailbox with string[] and uint32[3]', ARRAY_VECTOR),
    ];

    const msgVec = signMessage('0x48656c6c6f2c20514f4c21', PINNED_SEED, { randomized: false });
    const typedVec = signTypedData(LOGIN_CHALLENGE, PINNED_SEED, { randomized: false });

    const signingVectors = [
      {
        label: 'signMessage Hello, QRL!',
        hexSeed: PINNED_SEED,
        messageHex: '0x48656c6c6f2c20514f4c21',
        signature: msgVec.signature,
        publicKey: msgVec.publicKey,
        signer: msgVec.signer,
        digest: msgVec.digest,
      },
      {
        label: 'signTypedData LoginChallenge',
        hexSeed: PINNED_SEED,
        payload: LOGIN_CHALLENGE,
        signature: typedVec.signature,
        publicKey: typedVec.publicKey,
        signer: typedVec.signer,
        digest: typedVec.digest,
      },
    ];

    const canonical = {
      schemeVersionMsg: 'QRL-SIGN-MSG-v1',
      schemeVersionTyped: 'QRL-SIGN-TYPED-v1',
      messageVectors,
      typedVectors,
      signingVectors,
    };

    const outDir = join(__dirname, '..', '__fixtures__');
    mkdirSync(outDir, { recursive: true });
    const outPath = join(outDir, 'canonical.json');
    writeFileSync(outPath, JSON.stringify(canonical, null, 2) + '\n', 'utf-8');
    expect(true).toBe(true);
  });
});
