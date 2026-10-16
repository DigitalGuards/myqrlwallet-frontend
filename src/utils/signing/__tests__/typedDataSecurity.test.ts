import { performance } from 'node:perf_hooks';
import {
  baseTypeName,
  computeTypedDataDigest,
  encodeField,
  encodeType,
  hashStruct,
  TYPED_DATA_LIMITS,
  typedDataSchemeVersion,
} from '../typedData';
import { SignTypedDataParamsSchema } from '../types';
import { malformed } from '@/test-utils/malformed';
import type { TypeMap } from '../typedData';

const SIGNER = `Q${'0'.repeat(128)}`;
const LEGACY_Q40 = `Q${'0'.repeat(40)}`;

function payloadWith(fieldType: string, value: unknown) {
  return {
    types: {
      QRLDomain: [{ name: 'name', type: 'string' }],
      Payload: [{ name: 'value', type: fieldType }],
    },
    primaryType: 'Payload',
    domain: { name: 'Security test' },
    message: { value },
  };
}

function errorMessageFor(action: () => unknown): string {
  try {
    action();
  } catch (error) {
    if (error instanceof Error) return error.message;
    throw error;
  }
  throw new Error('expected typed data validation to fail');
}

describe('typed data base type names', () => {
  it.each([
    ['uint256', 'uint256'],
    ['address[]', 'address'],
    ['Struct[][3]', 'Struct'],
    ['bytes32[2][]', 'bytes32'],
    ['string', 'string'],
    ['', ''],
    ['[]', ''],
    ['[3][]', ''],
    ['Struct[003][]', 'Struct'],
    ['Struct[]x', 'Struct[]x'],
    ['Struct[x][]', 'Struct[x]'],
    ['Struct[[3]][]', 'Struct[[3]]'],
    ['Struct[+3][]', 'Struct[+3]'],
    ['Struct[\u0663][]', 'Struct[\u0663]'],
    ['Struct[3', 'Struct[3'],
    ['Struct3]', 'Struct3]'],
    ['Struct[]\n', 'Struct[]\n'],
    ['Struct[]\r\n', 'Struct[]\r\n'],
    ['Struct[]\u2028', 'Struct[]\u2028'],
    ['Struct[]\u2029', 'Struct[]\u2029'],
    ['[]'.repeat(TYPED_DATA_LIMITS.maxFieldTypeLength / 2), ''],
    [`[${'9'.repeat(TYPED_DATA_LIMITS.maxFieldTypeLength - 2)}]`, ''],
  ])('preserves legacy suffix removal for %j', (type, expected) => {
    expect(baseTypeName(type)).toBe(expected);
    expect(baseTypeName(type)).toBe(type.replace(/(\[\d*\])+$/, ''));
  });
});

describe('typed data deterministic resource limits', () => {
  it.each([null, [], 'types'])(
    'rejects malformed type maps in direct encoder calls: %j', value => {
      const types = malformed<TypeMap>(value);
      expect(() => encodeType('Payload', types)).toThrow('struct types');
      expect(() => hashStruct('Payload', {}, types)).toThrow('struct types');
      expect(() => encodeField('uint8', 1, types)).toThrow('struct types');
    },
  );

  it.each([null, {}, { name: 1, type: 'uint8' }, { name: 'value', type: null }])(
    'rejects malformed field definitions in direct encoder calls: %j', field => {
      const types = malformed<TypeMap>({ Payload: [field] });
      expect(() => encodeType('Payload', types)).toThrow('bad field');
      expect(() => hashStruct('Payload', { value: 1 }, types)).toThrow('bad field');
      expect(() => encodeField('uint8', 1, types)).toThrow('bad field');
    },
  );

  it('rejects a 1 MB field type in under 100 ms with a bounded error', () => {
    const fieldType = '[]'.repeat(500_000) + 'x';
    const payload = payloadWith(fieldType, []);
    const started = performance.now();
    const message = errorMessageFor(() => computeTypedDataDigest(payload));
    const elapsed = performance.now() - started;

    expect(elapsed).toBeLessThan(100);
    expect(message).toBe(`field type too long: ${'[]'.repeat(16)}... (length 1000001)`);
  });

  it('checks field type length in every struct before resolving dependencies', () => {
    const types = {
      QRLDomain: [{ name: 'name', type: 'string' }],
      Payload: [{ name: 'value', type: 'uint8' }],
      Unused: [{ name: 'value', type: '[]'.repeat(500_000) + 'x' }],
    };
    expect(() => encodeType('Payload', types)).toThrow('field type too long');
    expect(() => hashStruct('Payload', { value: 1 }, types)).toThrow('field type too long');
    expect(() => encodeField('uint8', 1, types)).toThrow('field type too long');
    expect(() =>
      typedDataSchemeVersion({
        types,
        primaryType: 'Payload',
        domain: { name: 'Security test' },
        message: { value: 1 },
      }),
    ).toThrow('field type too long');
  });

  it('preserves the inclusive field type length limit', () => {
    const padding = '0'.repeat(TYPED_DATA_LIMITS.maxFieldTypeLength - 'uint8[1]'.length);
    const fieldType = `uint8[${padding}1]`;
    expect(fieldType).toHaveLength(TYPED_DATA_LIMITS.maxFieldTypeLength);
    expect(() => computeTypedDataDigest(payloadWith(fieldType, [1]))).not.toThrow();
    expect(() => computeTypedDataDigest(payloadWith(`uint8[0${padding}1]`, [1]))).toThrow(
      'field type too long',
    );
  });

  it('bounds untrusted identifiers, field types, addresses and object keys in errors', () => {
    const input = 'x'.repeat(1_000_000);
    const types = { Payload: [{ name: 'value', type: 'uint8' }] };
    const actions = [
      () => encodeType(input, types),
      () => hashStruct(input, {}, types),
      () => encodeType('Payload', { [input]: types.Payload }),
      () => encodeType('Payload', { Payload: [{ name: input, type: 'uint8' }] }),
      () => encodeType('Payload', { Payload: [{ name: input, type: '' }] }),
      () => encodeField(input, 1, types),
      () => computeTypedDataDigest(payloadWith('address', input)),
      () => hashStruct('Payload', { value: 1, [input]: 2 }, types),
    ];
    for (const action of actions) {
      const message = errorMessageFor(action);
      expect(message).toContain(`${'x'.repeat(32)}... (length 1000000)`);
      expect(message.length).toBeLessThan(160);
    }
  });

  it('bounds invalid integer strings and out-of-range integer values in errors', () => {
    const types = { Payload: [{ name: 'value', type: 'uint8' }] };
    for (const input of ['x'.repeat(80), '9'.repeat(80), `-${'9'.repeat(79)}`]) {
      const message = errorMessageFor(() => encodeField('uint8', input, types));
      expect(message).toContain(`${input.slice(0, 32)}... (length 80)`);
      expect(message.length).toBeLessThan(100);
    }
    expect(() => encodeField('uint8', 'bad', types)).toThrow('invalid uint8 string: bad');
  });

  it('rejects unsigned top-level and type-definition display fields', () => {
    const topLevelExtra = {
      ...payloadWith('uint8', 1),
      displayName: 'Approve harmless login',
    };
    expect(() => computeTypedDataDigest(topLevelExtra)).toThrow(/unknown top-level fields/);
    expect(SignTypedDataParamsSchema.safeParse([SIGNER, topLevelExtra]).success).toBe(false);

    const base = payloadWith('uint8', 1);
    const payload = {
      ...base,
      types: {
        ...base.types,
        Payload: [{ name: 'value', type: 'uint8', displayType: 'string' }],
      },
    };
    expect(() => computeTypedDataDigest(payload)).toThrow(/struct map/);
    expect(SignTypedDataParamsSchema.safeParse([SIGNER, payload]).success).toBe(false);
  });

  it.each(['string', 'address', 'bool', 'bytes', 'uint256', 'int8', 'bytes32'])(
    'rejects a struct that shadows the reserved atomic type %s',
    (reservedName) => {
      expect(() =>
        computeTypedDataDigest({
          types: {
            QRLDomain: [{ name: 'name', type: 'string' }],
            Payload: [{ name: 'value', type: reservedName }],
            [reservedName]: [{ name: 'hidden', type: 'uint8' }],
          },
          primaryType: 'Payload',
          domain: { name: 'Security test' },
          message: { value: { hidden: 1 } },
        }),
      ).toThrow(/reserved by an atomic type/);
    },
  );

  it('rejects QRLDomain as the primary message type', () => {
    expect(() =>
      computeTypedDataDigest({
        types: { QRLDomain: [{ name: 'name', type: 'string' }] },
        primaryType: 'QRLDomain',
        domain: { name: 'Security test' },
        message: { name: 'visually duplicated domain' },
      }),
    ).toThrow(/cannot be the primary type/);
  });

  it('rejects more than the maximum number of struct types', () => {
    const types: Record<string, Array<{ name: string; type: string }>> = {
      QRLDomain: [{ name: 'name', type: 'string' }],
      Payload: [{ name: 'value', type: 'uint8' }],
    };
    for (let index = 0; index < TYPED_DATA_LIMITS.maxTypes; index += 1) {
      types[`Unused${index}`] = [{ name: 'value', type: 'uint8' }];
    }
    expect(() =>
      computeTypedDataDigest({
        types,
        primaryType: 'Payload',
        domain: { name: 'Security test' },
        message: { value: 1 },
      }),
    ).toThrow(/struct map|struct types/);
  });

  it('rejects per-struct and aggregate field-count excesses', () => {
    const tooManyFields = new Array(TYPED_DATA_LIMITS.maxFieldsPerType + 1)
      .fill(null)
      .map((_, index) => ({ name: `field${index}`, type: 'uint8' }));
    expect(() =>
      computeTypedDataDigest({
        types: {
          QRLDomain: [{ name: 'name', type: 'string' }],
          Payload: tooManyFields,
        },
        primaryType: 'Payload',
        domain: { name: 'Security test' },
        message: {},
      }),
    ).toThrow(/struct map|invalid struct/);

    const types: Record<string, Array<{ name: string; type: string }>> = {
      QRLDomain: [{ name: 'name', type: 'string' }],
      Payload: [{ name: 'root', type: 'Chunk0' }],
    };
    for (let typeIndex = 0; typeIndex < 8; typeIndex += 1) {
      types[`Chunk${typeIndex}`] = new Array(32).fill(null).map((_, fieldIndex) => ({
        name: `field${fieldIndex}`,
        type: 'uint8',
      }));
    }
    expect(() =>
      computeTypedDataDigest({
        types,
        primaryType: 'Payload',
        domain: { name: 'Security test' },
        message: { root: {} },
      }),
    ).toThrow('too many fields');
  });

  it('rejects deep struct graphs and array type nesting', () => {
    const types: Record<string, Array<{ name: string; type: string }>> = {
      QRLDomain: [{ name: 'name', type: 'string' }],
    };
    let message: Record<string, unknown> = { value: 1 };
    for (let index = TYPED_DATA_LIMITS.maxTypeGraphDepth + 2; index >= 0; index -= 1) {
      const next = `Node${index + 1}`;
      types[`Node${index}`] = [
        {
          name: 'value',
          type: index > TYPED_DATA_LIMITS.maxTypeGraphDepth + 1 ? 'uint8' : next,
        },
      ];
      if (index <= TYPED_DATA_LIMITS.maxTypeGraphDepth + 1) message = { value: message };
    }
    expect(() =>
      computeTypedDataDigest({
        types,
        primaryType: 'Node0',
        domain: { name: 'Security test' },
        message,
      }),
    ).toThrow('type graph nesting too deep');

    const nestedArrayType = `uint8${'[]'.repeat(TYPED_DATA_LIMITS.maxArrayNesting + 1)}`;
    expect(() => computeTypedDataDigest(payloadWith(nestedArrayType, []))).toThrow(
      'type nesting too deep',
    );
  });

  it('caps array length and total recursively encoded values', () => {
    expect(() =>
      computeTypedDataDigest(
        payloadWith('uint8[]', new Array(TYPED_DATA_LIMITS.maxArrayLength + 1).fill(1)),
      ),
    ).toThrow('exceeds length limit');

    const fields = new Array(8).fill(null).map((_, index) => ({
      name: `items${index}`,
      type: 'uint8[]',
    }));
    const message = Object.fromEntries(
      fields.map((field) => [
        field.name,
        new Array(TYPED_DATA_LIMITS.maxArrayLength).fill(1),
      ]),
    );
    expect(() =>
      computeTypedDataDigest({
        types: {
          QRLDomain: [{ name: 'name', type: 'string' }],
          Payload: fields,
        },
        primaryType: 'Payload',
        domain: { name: 'Security test' },
        message,
      }),
    ).toThrow('too many encoded values');
  });

  it('caps dynamic byte values by encoded byte length', () => {
    expect(() =>
      computeTypedDataDigest(
        payloadWith('bytes', `0x${'aa'.repeat(TYPED_DATA_LIMITS.maxDynamicBytes + 1)}`),
      ),
    ).toThrow('bytes field exceeds typed data byte limit');
    expect(() =>
      computeTypedDataDigest(
        payloadWith('string', '€'.repeat(Math.ceil(TYPED_DATA_LIMITS.maxDynamicBytes / 3) + 1)),
      ),
    ).toThrow('string field exceeds typed data byte limit');
  });

  it('encodes QIP-55 address fields under typed-data v2 and keeps Q+40 rejected', () => {
    const payload = payloadWith('address', SIGNER);
    expect(typedDataSchemeVersion(payload)).toBe('QRL-SIGN-TYPED-v2');
    expect(computeTypedDataDigest(payload)).toHaveLength(64);
    expect(() => computeTypedDataDigest(payloadWith('address', LEGACY_Q40))).toThrow(
      'invalid Q-address',
    );
    // Address-free payloads keep v1.
    expect(typedDataSchemeVersion(payloadWith('uint8', 1))).toBe('QRL-SIGN-TYPED-v1');
  });

  it('accepts a QIP-55 signer at the request boundary and rejects Q+40', () => {
    const payload = payloadWith('uint8', 1);
    expect(SignTypedDataParamsSchema.safeParse([SIGNER, payload]).success).toBe(true);
    expect(SignTypedDataParamsSchema.safeParse([LEGACY_Q40, payload]).success).toBe(false);
  });

  it('rejects unsafe or unbounded identifiers', () => {
    expect(() =>
      computeTypedDataDigest({
        types: {
          QRLDomain: [{ name: 'name', type: 'string' }],
          Payload: [{ name: 'constructor', type: 'string' }],
        },
        primaryType: 'Payload',
        domain: { name: 'Security test' },
        message: { constructor: 'hidden' },
      }),
    ).toThrow('invalid field name');
    expect(() =>
      computeTypedDataDigest({
        types: {
          QRLDomain: [{ name: 'name', type: 'string' }],
          ['A'.repeat(TYPED_DATA_LIMITS.maxIdentifierLength + 1)]: [
            { name: 'value', type: 'uint8' },
          ],
        },
        primaryType: 'A'.repeat(TYPED_DATA_LIMITS.maxIdentifierLength + 1),
        domain: { name: 'Security test' },
        message: { value: 1 },
      }),
    ).toThrow('invalid struct name');
  });

  it('still accepts bounded nested structs and arrays', () => {
    expect(() =>
      computeTypedDataDigest({
        types: {
          QRLDomain: [{ name: 'name', type: 'string' }],
          Payload: [{ name: 'items', type: 'Item[]' }],
          Item: [{ name: 'value', type: 'uint16' }],
        },
        primaryType: 'Payload',
        domain: { name: 'Security test' },
        message: { items: [{ value: 1 }, { value: 2 }] },
      }),
    ).not.toThrow();
  });
});
