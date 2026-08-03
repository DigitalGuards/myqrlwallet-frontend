/**
 * EIP-712-shaped typed-data encoding for `qrl_signTypedData` v1.
 *
 * The shape is borrowed (types/domain/primaryType/message), but the
 * primitives are post-quantum-native:
 *   - SHAKE256 (not Keccak-256), 64-byte outputs
 *   - Native Dilithium ctx (set in sign.ts, not here)
 *   - QRLDomain struct (not Ethereum's EIP712Domain)
 *
 * Encoder and hasher live in the same file because `encodeField` and
 * `hashStruct` are mutually recursive (struct fields trigger hashStruct
 * for nested types). Keeping them together avoids circular imports and
 * matches the algorithm description in docs/POST-QUANTUM-SIGNING-PLAN.md.
 */

import { shake256 } from '@noble/hashes/sha3.js';
import { SCHEME_TAG_TYPED, DIGEST_LEN } from './ctx';
import { hexToBytes, concatBytes, concatBytesArr } from './bytes';
import { isValidQrlAddress } from '@/utils/web3/address';

const SLOT = 32;

export const TYPED_DATA_LIMITS = Object.freeze({
  maxTypes: 32,
  maxFieldsPerType: 32,
  maxTotalFields: 256,
  maxTypeGraphDepth: 12,
  maxArrayNesting: 12,
  maxArrayLength: 256,
  maxEncodedValues: 2048,
  maxDynamicBytes: 16 * 1024,
  maxIdentifierLength: 64,
  maxFieldTypeLength: 128,
});

export type FieldType = string;
export interface TypedField {
  name: string;
  type: FieldType;
}
export type StructDef = readonly TypedField[];
export type TypeMap = Record<string, StructDef>;
export type Domain = Record<string, unknown>;
export type Message = Record<string, unknown>;

export interface TypedDataPayload {
  types: TypeMap;
  primaryType: string;
  domain: Domain;
  message: Message;
}

type AtomicKind =
  | { kind: 'address' | 'bool' | 'string' | 'bytes' }
  | { kind: 'uintN' | 'intN'; width: number }
  | { kind: 'bytesN'; width: number }
  | { kind: 'array'; inner: FieldType; size?: number }
  | { kind: 'ref'; name: string };

function isMessageObject(value: unknown): value is Message {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasExactOwnKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const keys = Object.keys(value);
  return keys.length === expected.length && expected.every((key) => keys.includes(key));
}

function isTypedField(value: unknown): value is TypedField {
  return (
    isMessageObject(value) &&
    hasExactOwnKeys(value, ['name', 'type']) &&
    typeof value['name'] === 'string' &&
    typeof value['type'] === 'string'
  );
}

function isTypeMap(value: unknown): value is TypeMap {
  if (!isMessageObject(value)) return false;
  let typeCount = 0;
  for (const name in value) {
    if (!Object.prototype.hasOwnProperty.call(value, name)) continue;
    typeCount += 1;
    if (typeCount > TYPED_DATA_LIMITS.maxTypes) return false;
    const definition = value[name];
    if (
      !Array.isArray(definition) ||
      definition.length > TYPED_DATA_LIMITS.maxFieldsPerType ||
      !definition.every(isTypedField)
    ) {
      return false;
    }
  }
  return true;
}

function parsePayload(payload: unknown): TypedDataPayload {
  if (!isMessageObject(payload)) throw new Error('invalid typed data payload');
  if (!hasExactOwnKeys(payload, ['types', 'primaryType', 'domain', 'message'])) {
    throw new Error('typed data payload contains unknown top-level fields');
  }
  const types = payload['types'];
  const primaryType = payload['primaryType'];
  const domain = payload['domain'];
  const message = payload['message'];
  if (!isTypeMap(types)) throw new Error('typed data types must be a struct map');
  if (typeof primaryType !== 'string') {
    throw new Error('typed data primaryType must be a string');
  }
  if (!isMessageObject(domain)) throw new Error('typed data domain must be an object');
  if (!isMessageObject(message)) throw new Error('typed data message must be an object');
  return { types, primaryType, domain, message };
}

const ATOMIC_RE = /^(?:(address|bool|string|bytes)|(u?int)(\d+)|bytes(\d+)|(.+?)\[(\d*)\])$/;
const IDENTIFIER_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;
const UNSAFE_OBJECT_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

interface EncodingBudget {
  remainingValues: number;
}

function consumeValue(budget: EncodingBudget): void {
  budget.remainingValues -= 1;
  if (budget.remainingValues < 0) {
    throw new Error('typed data contains too many encoded values');
  }
}

function assertIdentifier(value: string, label: string): void {
  if (
    !IDENTIFIER_RE.test(value) ||
    value.length > TYPED_DATA_LIMITS.maxIdentifierLength ||
    UNSAFE_OBJECT_KEYS.has(value)
  ) {
    throw new Error(`invalid ${label}: ${value}`);
  }
}

function parseFieldType(type: FieldType, types: TypeMap, depth = 0): AtomicKind {
  if (depth > TYPED_DATA_LIMITS.maxArrayNesting) {
    throw new Error(`type nesting too deep: ${type}`);
  }
  if (type.length > TYPED_DATA_LIMITS.maxFieldTypeLength) {
    throw new Error(`field type too long: ${type}`);
  }
  const m = ATOMIC_RE.exec(type);
  if (m) {
    const [, atomic, intKind, intWidthStr, bytesWidthStr, innerType, sizeStr] = m;
    if (atomic) return { kind: atomic as 'address' | 'bool' | 'string' | 'bytes' };
    if (intKind) {
      const width = Number(intWidthStr);
      if (!Number.isInteger(width) || width < 8 || width > 256 || width % 8 !== 0) {
        throw new Error(`invalid int width: ${type}`);
      }
      return { kind: intKind === 'uint' ? 'uintN' : 'intN', width };
    }
    if (bytesWidthStr) {
      const width = Number(bytesWidthStr);
      if (!Number.isInteger(width) || width < 1 || width > 32) {
        throw new Error(`invalid bytesN width: ${type}`);
      }
      return { kind: 'bytesN', width };
    }
    if (innerType !== undefined) {
      parseFieldType(innerType, types, depth + 1);
      if (sizeStr) {
        const size = Number(sizeStr);
        if (
          !Number.isSafeInteger(size) ||
          size <= 0 ||
          size > TYPED_DATA_LIMITS.maxArrayLength
        ) {
          throw new Error(`invalid array size: ${type}`);
        }
        return { kind: 'array', inner: innerType, size };
      }
      return { kind: 'array', inner: innerType };
    }
  }
  if (Object.prototype.hasOwnProperty.call(types, type)) {
    return { kind: 'ref', name: type };
  }
  throw new Error(`unknown type: ${type}`);
}

function isReservedAtomicTypeName(name: string): boolean {
  if (/^(?:address|bool|string|bytes)$/.test(name)) return true;
  const intMatch = /^(?:u?int)(\d+)$/.exec(name);
  if (intMatch) {
    const width = Number(intMatch[1]);
    return Number.isInteger(width) && width >= 8 && width <= 256 && width % 8 === 0;
  }
  const bytesMatch = /^bytes(\d+)$/.exec(name);
  if (bytesMatch) {
    const width = Number(bytesMatch[1]);
    return Number.isInteger(width) && width >= 1 && width <= 32;
  }
  return false;
}

function baseTypeName(type: FieldType): string {
  return type.replace(/(\[\d*\])+$/, '');
}

function collectDependencies(primary: string, types: TypeMap): Set<string> {
  if (!Object.prototype.hasOwnProperty.call(types, primary)) {
    throw new Error(`unknown primary type: ${primary}`);
  }
  const visited = new Set<string>();
  const visit = (name: string, path: string[]): void => {
    if (path.length > TYPED_DATA_LIMITS.maxTypeGraphDepth) {
      throw new Error(`type graph nesting too deep: ${[...path, name].join(' -> ')}`);
    }
    if (path.includes(name)) {
      throw new Error(`cyclic type reference: ${[...path, name].join(' -> ')}`);
    }
    if (visited.has(name)) return;
    visited.add(name);
    const fields = types[name];
    if (!fields) throw new Error(`unknown type: ${name}`);
    for (const f of fields) {
      const base = baseTypeName(f.type);
      if (Object.prototype.hasOwnProperty.call(types, base)) {
        visit(base, [...path, name]);
      }
      // Always validate the full field type (including struct-array dimensions
      // like Party[0]) here, not only at encode time.
      parseFieldType(f.type, types);
    }
  };
  visit(primary, []);
  return visited;
}

function validateTypeMap(types: TypeMap): void {
  const entries = Object.entries(types);
  if (entries.length === 0 || entries.length > TYPED_DATA_LIMITS.maxTypes) {
    throw new Error(`typed data must contain 1-${TYPED_DATA_LIMITS.maxTypes} struct types`);
  }
  let totalFields = 0;
  for (const [name, def] of entries) {
    assertIdentifier(name, 'struct name');
    if (name !== 'QRLDomain' && isReservedAtomicTypeName(name)) {
      throw new Error(`struct name is reserved by an atomic type: ${name}`);
    }
    if (
      !Array.isArray(def) ||
      def.length === 0 ||
      def.length > TYPED_DATA_LIMITS.maxFieldsPerType
    ) {
      throw new Error(`empty or invalid struct: ${name}`);
    }
    totalFields += def.length;
    if (totalFields > TYPED_DATA_LIMITS.maxTotalFields) {
      throw new Error('typed data contains too many fields');
    }
    const seen = new Set<string>();
    for (const f of def) {
      if (!f || typeof f.name !== 'string' || !f.name) {
        throw new Error(`bad field in ${name}`);
      }
      if (typeof f.type !== 'string' || !f.type) {
        throw new Error(`bad field type in ${name}.${f.name}`);
      }
      assertIdentifier(f.name, `field name in ${name}`);
      if (seen.has(f.name)) {
        throw new Error(`duplicate field "${f.name}" in ${name}`);
      }
      seen.add(f.name);
    }
  }
}

/**
 * Canonical `encodeType` form: `Primary(t n,...)Referenced1(...)Referenced2(...)`
 * with primary first and referenced structs sorted alphabetically by name.
 *
 * This only emits structs reachable from `primary`. Unused-declaration
 * rejection is a payload-level concern (the union of reachable sets across
 * QRLDomain + primaryType) and lives in `computeTypedDataDigest`.
 */
export function encodeType(primary: string, types: TypeMap): string {
  validateTypeMap(types);
  const deps = collectDependencies(primary, types);
  const others = [...deps].filter((n) => n !== primary).sort();
  return [primary, ...others]
    .map((name) => {
      const fields = types[name];
      if (!fields) {
        // Every dependency is collected from `types`, so this is unreachable;
        // throw rather than silently emit a wrong encodeType (which would
        // change the type hash and thus the signature).
        throw new Error(`encodeType: missing type definition for ${name}`);
      }
      const inner = fields.map((f) => `${f.type} ${f.name}`).join(',');
      return `${name}(${inner})`;
    })
    .join('');
}

export function typeHash(primary: string, types: TypeMap): Uint8Array {
  return shake256(new TextEncoder().encode(encodeType(primary, types)), { dkLen: DIGEST_LEN });
}

function parseQAddress(addr: string): Uint8Array {
  if (!isValidQrlAddress(addr)) {
    throw new Error(`invalid Q-address: ${String(addr)}`);
  }
  return hexToBytes('0x' + addr.slice(1).toLowerCase());
}

function padLeft32(bytes: Uint8Array): Uint8Array {
  if (bytes.length > SLOT) throw new Error('cannot pad: bytes > 32');
  const out = new Uint8Array(SLOT);
  out.set(bytes, SLOT - bytes.length);
  return out;
}

function padRight32(bytes: Uint8Array): Uint8Array {
  if (bytes.length > SLOT) throw new Error('cannot pad: bytes > 32');
  const out = new Uint8Array(SLOT);
  out.set(bytes, 0);
  return out;
}

function bigIntToSlot(value: bigint, width: number, signed: boolean): Uint8Array {
  if (signed) {
    const limit = 1n << BigInt(width - 1);
    if (value >= limit || value < -limit) {
      throw new Error(`int${width} out of range: ${value}`);
    }
  } else {
    if (value < 0n) throw new Error(`uint${width} negative: ${value}`);
    const limit = 1n << BigInt(width);
    if (value >= limit) throw new Error(`uint${width} out of range: ${value}`);
  }
  // Represent in two's complement over the full 32-byte slot.
  const slotMask = (1n << 256n) - 1n;
  const repr = value < 0n ? (value + (1n << 256n)) & slotMask : value;
  const out = new Uint8Array(SLOT);
  let v = repr;
  for (let i = SLOT - 1; i >= 0; i--) {
    out[i] = Number(v & 0xffn);
    v >>= 8n;
  }
  return out;
}

function parseIntValue(v: unknown, typeLabel: string): bigint {
  if (typeof v === 'bigint') return v;
  if (typeof v === 'string') {
    if (v.length > 80) throw new Error(`${typeLabel} value is too long`);
    if (/^-?0x[0-9a-fA-F]+$/i.test(v)) {
      // BigInt() throws on a "-0x.." literal, so split the sign off first.
      const isNegative = v.startsWith('-');
      const abs = BigInt(isNegative ? v.slice(1) : v);
      return isNegative ? -abs : abs;
    }
    if (!/^-?(0|[1-9]\d*)$/.test(v)) {
      throw new Error(`invalid ${typeLabel} string: ${v}`);
    }
    return BigInt(v);
  }
  if (typeof v === 'number') {
    if (!Number.isInteger(v) || !Number.isSafeInteger(v)) {
      throw new Error(`unsafe ${typeLabel} number: ${v}, pass as string`);
    }
    return BigInt(v);
  }
  throw new Error(`unsupported ${typeLabel} value: ${typeof v}`);
}

function encodeFieldWithBudget(
  type: FieldType,
  value: unknown,
  types: TypeMap,
  budget: EncodingBudget,
  depth: number,
): Uint8Array {
  if (depth > TYPED_DATA_LIMITS.maxTypeGraphDepth + TYPED_DATA_LIMITS.maxArrayNesting) {
    throw new Error(`value nesting too deep: ${type}`);
  }
  consumeValue(budget);
  const parsed = parseFieldType(type, types);

  switch (parsed.kind) {
    case 'ref':
      if (!isMessageObject(value)) {
        throw new Error(`struct field expects object: ${type}`);
      }
      return hashStructWithBudget(parsed.name, value, types, budget, depth + 1);

    case 'address':
      if (typeof value !== 'string') {
        throw new Error(`address field expects string: ${typeof value}`);
      }
      return padLeft32(parseQAddress(value));

    case 'bool':
      if (typeof value !== 'boolean') {
        throw new Error(`bool field expects boolean: ${typeof value}`);
      }
      return padLeft32(new Uint8Array([value ? 1 : 0]));

    case 'string': {
      if (typeof value !== 'string') {
        throw new Error(`string field expects string: ${typeof value}`);
      }
      if (value.length > TYPED_DATA_LIMITS.maxDynamicBytes) {
        throw new Error('string field exceeds typed data byte limit');
      }
      const encoded = new TextEncoder().encode(value);
      if (encoded.length > TYPED_DATA_LIMITS.maxDynamicBytes) {
        throw new Error('string field exceeds typed data byte limit');
      }
      return shake256(encoded, { dkLen: DIGEST_LEN });
    }

    case 'bytes':
      if (typeof value !== 'string') {
        throw new Error(`bytes field expects 0x-hex string: ${typeof value}`);
      }
      if (value.length > TYPED_DATA_LIMITS.maxDynamicBytes * 2 + 2) {
        throw new Error('bytes field exceeds typed data byte limit');
      }
      return shake256(hexToBytes(value), { dkLen: DIGEST_LEN });

    case 'uintN':
      return bigIntToSlot(parseIntValue(value, `uint${parsed.width}`), parsed.width, false);

    case 'intN':
      return bigIntToSlot(parseIntValue(value, `int${parsed.width}`), parsed.width, true);

    case 'bytesN': {
      if (typeof value !== 'string') {
        throw new Error(`bytes${parsed.width} expects 0x-hex string: ${typeof value}`);
      }
      if (value.length !== parsed.width * 2 + 2) {
        throw new Error(`bytes${parsed.width} requires ${parsed.width} bytes`);
      }
      const raw = hexToBytes(value);
      if (raw.length !== parsed.width) {
        throw new Error(`bytes${parsed.width} requires ${parsed.width} bytes, got ${raw.length}`);
      }
      return padRight32(raw);
    }

    case 'array': {
      if (!Array.isArray(value)) {
        throw new Error(`array field expects array: ${typeof value}`);
      }
      if (value.length > TYPED_DATA_LIMITS.maxArrayLength) {
        throw new Error(`array ${type} exceeds length limit`);
      }
      if (parsed.size !== undefined && value.length !== parsed.size) {
        throw new Error(`fixed array ${type} requires length ${parsed.size}, got ${value.length}`);
      }
      const chunks = value.map((v) =>
        encodeFieldWithBudget(parsed.inner, v, types, budget, depth + 1),
      );
      return shake256(concatBytesArr(chunks), { dkLen: DIGEST_LEN });
    }
  }
}

export function encodeField(type: FieldType, value: unknown, types: TypeMap): Uint8Array {
  validateTypeMap(types);
  return encodeFieldWithBudget(
    type,
    value,
    types,
    { remainingValues: TYPED_DATA_LIMITS.maxEncodedValues },
    0,
  );
}

function hashStructWithBudget(
  primary: string,
  data: Message,
  types: TypeMap,
  budget: EncodingBudget,
  depth: number,
): Uint8Array {
  consumeValue(budget);
  const fields = types[primary];
  if (!fields) throw new Error(`unknown struct: ${primary}`);
  const expected = new Set(fields.map((f) => f.name));
  let ownFieldCount = 0;
  for (const k in data) {
    if (!Object.prototype.hasOwnProperty.call(data, k)) continue;
    ownFieldCount += 1;
    if (ownFieldCount > TYPED_DATA_LIMITS.maxEncodedValues) {
      throw new Error('typed data object contains too many fields');
    }
    if (!expected.has(k)) throw new Error(`unknown field in ${primary}: ${k}`);
  }
  const parts: Uint8Array[] = [typeHash(primary, types)];
  for (const f of fields) {
    if (!Object.prototype.hasOwnProperty.call(data, f.name)) {
      throw new Error(`missing field ${primary}.${f.name}`);
    }
    parts.push(encodeFieldWithBudget(f.type, data[f.name], types, budget, depth + 1));
  }
  return shake256(concatBytesArr(parts), { dkLen: DIGEST_LEN });
}

export function hashStruct(primary: string, data: Message, types: TypeMap): Uint8Array {
  validateTypeMap(types);
  return hashStructWithBudget(
    primary,
    data,
    types,
    { remainingValues: TYPED_DATA_LIMITS.maxEncodedValues },
    0,
  );
}

/**
 * `QRLDomain` is wallet-reserved. Only the following field names are
 * allowed and each is fixed to its expected type:
 *
 *   name              : string    (required)
 *   version           : string    (optional)
 *   chainId           : uint256   (optional)
 *   verifyingContract : address   (optional)
 *   salt              : bytes32   (optional)
 *
 * Any other field name, or a type mismatch on a reserved name, is rejected.
 */
const RESERVED_DOMAIN_FIELDS: Record<string, string> = {
  name: 'string',
  version: 'string',
  chainId: 'uint256',
  verifyingContract: 'address',
  salt: 'bytes32',
};

function validateDomainTypes(types: TypeMap): void {
  const def = types['QRLDomain'];
  if (!def) throw new Error('QRLDomain type is required');
  let hasName = false;
  for (const f of def) {
    const expected = RESERVED_DOMAIN_FIELDS[f.name];
    if (!expected) {
      throw new Error(
        `QRLDomain field "${f.name}" not in reserved set ` +
          `(name, version, chainId, verifyingContract, salt)`,
      );
    }
    if (f.type !== expected) {
      throw new Error(`QRLDomain field "${f.name}" must be type "${expected}", got "${f.type}"`);
    }
    if (f.name === 'name') hasName = true;
  }
  if (!hasName) throw new Error('QRLDomain.name is required');
}

function validatePayloadReachability(primary: string, types: TypeMap): void {
  const reachable = new Set<string>();
  for (const root of ['QRLDomain', primary]) {
    for (const t of collectDependencies(root, types)) reachable.add(t);
  }
  for (const k of Object.keys(types)) {
    if (!reachable.has(k)) throw new Error(`unused referenced type: ${k}`);
  }
}

/**
 * Final digest signed for `qrl_signTypedData`:
 *
 *   domainHash  = hashStruct("QRLDomain", domain, types)
 *   messageHash = hashStruct(primaryType, message, types)
 *   digest      = SHAKE256("QRL-SIGN-TYPED-v1" || domainHash || messageHash, 64)
 */
export function computeTypedDataDigest(payload: unknown): Uint8Array {
  const parsed = parsePayload(payload);
  validateTypeMap(parsed.types);
  assertIdentifier(parsed.primaryType, 'primary type');
  if (parsed.primaryType === 'QRLDomain') {
    throw new Error('QRLDomain cannot be the primary type');
  }
  validateDomainTypes(parsed.types);
  validatePayloadReachability(parsed.primaryType, parsed.types);
  const budget = { remainingValues: TYPED_DATA_LIMITS.maxEncodedValues };
  const domainHash = hashStructWithBudget('QRLDomain', parsed.domain, parsed.types, budget, 0);
  const messageHash = hashStructWithBudget(
    parsed.primaryType,
    parsed.message,
    parsed.types,
    budget,
    0,
  );
  return shake256(concatBytes(SCHEME_TAG_TYPED, domainHash, messageHash), { dkLen: DIGEST_LEN });
}
