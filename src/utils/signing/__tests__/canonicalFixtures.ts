import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { isArray, isRecord } from '@/utils/guards';
import type { TypedDataPayload, TypedDataSchemeVersion } from '..';

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

interface SchemeVector extends TypedVector {
  schemeVersion: TypedDataSchemeVersion;
}

interface SchemeSigningVector extends SigningVector {
  payload: TypedDataPayload;
  schemeVersion: TypedDataSchemeVersion;
  descriptor: string;
}

interface Canonical {
  schemeVersionMsg: 'QRL-SIGN-MSG-v1';
  schemeVersionTyped: 'QRL-SIGN-TYPED-v1';
  schemeVersionTypedV2: 'QRL-SIGN-TYPED-v2';
  messageVectors: MessageVector[];
  typedVectors: TypedVector[];
  signingVectors: SigningVector[];
  schemeVectors: SchemeVector[];
  schemeSigningVectors: SchemeSigningVector[];
}

function hasStrings<K extends string>(
  value: unknown,
  keys: readonly K[],
): value is Record<K, string> & Record<string, unknown> {
  return isRecord(value) && keys.every((key) => typeof value[key] === 'string');
}

function isPayload(value: unknown): value is TypedDataPayload {
  return (
    isRecord(value) &&
    typeof value['primaryType'] === 'string' &&
    isRecord(value['domain']) &&
    isRecord(value['message']) &&
    isRecord(value['types']) &&
    Object.values(value['types']).every(
      (fields) => isArray(fields) && fields.every((field) => hasStrings(field, ['name', 'type'])),
    )
  );
}

function isTypedVector(value: unknown): value is TypedVector {
  return (
    isRecord(value) &&
    hasStrings(value, [
      'label',
      'encodeTypeString',
      'typeHashHex',
      'domainHashHex',
      'messageHashHex',
      'digestHex',
    ]) &&
    isPayload(value['payload'])
  );
}

function isSigningVector(value: unknown): value is SigningVector {
  return (
    isRecord(value) &&
    hasStrings(value, ['label', 'hexSeed', 'signature', 'publicKey', 'signer', 'digest']) &&
    (value['messageHex'] === undefined || typeof value['messageHex'] === 'string') &&
    (value['payload'] === undefined || isPayload(value['payload'])) &&
    (value['messageHex'] !== undefined || value['payload'] !== undefined)
  );
}

function isScheme(value: unknown): value is TypedDataSchemeVersion {
  return value === 'QRL-SIGN-TYPED-v1' || value === 'QRL-SIGN-TYPED-v2';
}

function isCanonical(value: unknown): value is Canonical {
  if (!isRecord(value)) return false;
  const messages = value['messageVectors'];
  const typed = value['typedVectors'];
  const signing = value['signingVectors'];
  const schemes = value['schemeVectors'];
  const schemeSigning = value['schemeSigningVectors'];
  return (
    value['schemeVersionMsg'] === 'QRL-SIGN-MSG-v1' &&
    value['schemeVersionTyped'] === 'QRL-SIGN-TYPED-v1' &&
    value['schemeVersionTypedV2'] === 'QRL-SIGN-TYPED-v2' &&
    isArray(messages) &&
    messages.every((v) => hasStrings(v, ['label', 'messageHex', 'digestHex'])) &&
    isArray(typed) &&
    typed.every(isTypedVector) &&
    isArray(signing) &&
    signing.every(isSigningVector) &&
    isArray(schemes) &&
    schemes.every((v) => isRecord(v) && isTypedVector(v) && isScheme(v['schemeVersion'])) &&
    isArray(schemeSigning) &&
    schemeSigning.every(
      (v) =>
        isRecord(v) &&
        isSigningVector(v) &&
        isPayload(v.payload) &&
        isScheme(v['schemeVersion']) &&
        typeof v['descriptor'] === 'string',
    )
  );
}

export function readCanonical(): Canonical {
  const value: unknown = JSON.parse(
    readFileSync(join(__dirname, '..', '__fixtures__', 'canonical.json'), 'utf-8'),
  );
  if (!isCanonical(value)) throw new Error('Invalid canonical signing fixtures');
  return value;
}
