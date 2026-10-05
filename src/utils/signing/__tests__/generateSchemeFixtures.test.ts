/**
 * Generator for the typed-data scheme vectors in canonical.json:
 * `schemeVectors` (digests under the scheme each payload selects) and
 * `schemeSigningVectors` (deterministic ML-DSA-87 signatures). It leaves the
 * legacy v1 sections untouched.
 *
 * Skipped unless WRITE_SIGNING_FIXTURES=1:
 *   WRITE_SIGNING_FIXTURES=1 npx jest src/utils/signing/__tests__/generateSchemeFixtures.test.ts
 * The output is copied byte for byte into the SDK and extension fixtures.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { toChecksumAddress } from '@theqrl/wallet.js';
import {
  bytesToHex,
  computeTypedDataDigest,
  encodeType,
  hashStruct,
  signTypedData,
  typeHash,
  typedDataSchemeVersion,
  type TypedDataPayload,
} from '..';

const PINNED_SEED =
  '0x0100000580a227e1b6d5a89df7723a71e9c03535e9447ec6d160b68c0ba845c68a05c59226cce711eb3db312c022ccf9577be7';

/** A checksummed QIP-55 address made of one repeated byte. */
const address = (byteHex: string): string => toChecksumAddress(`Q${byteHex.repeat(64)}`);

const STAKE_INTENT: TypedDataPayload = {
  types: {
    QRLDomain: [
      { name: 'name', type: 'string' },
      { name: 'version', type: 'string' },
      { name: 'chainId', type: 'uint256' },
      { name: 'verifyingContract', type: 'address' },
    ],
    StakeIntent: [
      { name: 'staker', type: 'address' },
      { name: 'qrlAmount', type: 'uint256' },
      { name: 'minShares', type: 'uint256' },
      { name: 'referrer', type: 'address' },
      { name: 'nonce', type: 'uint256' },
      { name: 'deadline', type: 'uint64' },
    ],
  },
  primaryType: 'StakeIntent',
  domain: {
    name: 'QuantaPool',
    version: '1',
    chainId: '3151909',
    verifyingContract: address('a1'),
  },
  message: {
    staker: address('b2'),
    qrlAmount: '1000000000000000000000',
    minShares: '999000000000000000000',
    referrer: address('c3'),
    nonce: '7',
    deadline: '1790000000',
  },
};

const BATCH: TypedDataPayload = {
  types: {
    QRLDomain: [
      { name: 'name', type: 'string' },
      { name: 'salt', type: 'bytes32' },
    ],
    Batch: [
      { name: 'payer', type: 'Party' },
      { name: 'recipients', type: 'address[]' },
      { name: 'deltas', type: 'int256[2]' },
      { name: 'cap', type: 'uint256' },
      { name: 'small', type: 'int8' },
      { name: 'flag', type: 'bool' },
      { name: 'ref', type: 'bytes32' },
      { name: 'tag', type: 'bytes4' },
      { name: 'note', type: 'string' },
    ],
    Party: [
      { name: 'addr', type: 'address' },
      { name: 'memo', type: 'string' },
    ],
  },
  primaryType: 'Batch',
  domain: { name: 'qrl-batch', salt: '0x' + '5a'.repeat(32) },
  message: {
    payer: { addr: address('d4'), memo: 'payer note' },
    recipients: [address('e5'), address('f6'), address('07')],
    deltas: ['-1', '-57896044618658097711785492504343953926634992332820282019728792003956564819968'],
    cap: '115792089237316195423570985008687907853269984665640564039457584007913129639935',
    small: '-128',
    flag: true,
    ref: '0x' + '9e'.repeat(32),
    tag: '0xdeadbeef',
    note: 'two recipients and a refund',
  },
};

const DOMAIN_ADDRESS_ONLY: TypedDataPayload = {
  types: {
    QRLDomain: [
      { name: 'name', type: 'string' },
      { name: 'verifyingContract', type: 'address' },
    ],
    Ping: [{ name: 'count', type: 'uint8' }],
  },
  primaryType: 'Ping',
  domain: { name: 'ping', verifyingContract: address('18') },
  message: { count: '3' },
};

const ADDRESS_FREE: TypedDataPayload = {
  types: {
    QRLDomain: [
      { name: 'name', type: 'string' },
      { name: 'chainId', type: 'uint256' },
    ],
    Vote: [
      { name: 'proposal', type: 'uint32' },
      { name: 'support', type: 'bool' },
      { name: 'weight', type: 'int64' },
      { name: 'reason', type: 'string' },
    ],
  },
  primaryType: 'Vote',
  domain: { name: 'qrl-governance', chainId: '3151909' },
  message: { proposal: '12', support: false, weight: '-5', reason: 'not yet' },
};

function toSchemeVector(label: string, payload: TypedDataPayload) {
  const schemeVersion = typedDataSchemeVersion(payload);
  return {
    label,
    schemeVersion,
    payload,
    encodeTypeString: encodeType(payload.primaryType, payload.types),
    typeHashHex: bytesToHex(typeHash(payload.primaryType, payload.types)),
    domainHashHex: bytesToHex(hashStruct('QRLDomain', payload.domain, payload.types, schemeVersion)),
    messageHashHex: bytesToHex(
      hashStruct(payload.primaryType, payload.message, payload.types, schemeVersion),
    ),
    digestHex: bytesToHex(computeTypedDataDigest(payload)),
  };
}

function toSigningVector(label: string, payload: TypedDataPayload) {
  const signed = signTypedData(payload, PINNED_SEED, { randomized: false });
  return {
    label,
    hexSeed: PINNED_SEED,
    payload,
    schemeVersion: signed.schemeVersion,
    signature: signed.signature,
    publicKey: signed.publicKey,
    descriptor: signed.descriptor,
    signer: signed.signer,
    digest: signed.digest,
  };
}

const run = process.env['WRITE_SIGNING_FIXTURES'] === '1' ? describe : describe.skip;

run('typed-data scheme fixture generator', () => {
  it('adds schemeVectors and schemeSigningVectors to canonical.json', () => {
    const path = join(__dirname, '..', '__fixtures__', 'canonical.json');
    const canonical = JSON.parse(readFileSync(path, 'utf-8')) as Record<string, unknown>;
    canonical['schemeVersionTypedV2'] = 'QRL-SIGN-TYPED-v2';
    canonical['schemeVectors'] = [
      toSchemeVector('v2 StakeIntent with QIP-55 addresses', STAKE_INTENT),
      toSchemeVector('v2 Batch: nested Party, address[], negative and max ints, bytesN', BATCH),
      toSchemeVector('v2 address only in QRLDomain', DOMAIN_ADDRESS_ONLY),
      toSchemeVector('v1 address-free Vote', ADDRESS_FREE),
    ];
    canonical['schemeSigningVectors'] = [
      toSigningVector('signTypedData v2 StakeIntent', STAKE_INTENT),
      toSigningVector('signTypedData v1 address-free Vote', ADDRESS_FREE),
    ];
    writeFileSync(path, JSON.stringify(canonical, null, 2) + '\n', 'utf-8');
    expect(true).toBe(true);
  });
});
