import { computeTypedDataDigest, TYPED_DATA_LIMITS } from '../typedData';
import { SignTypedDataParamsSchema } from '../types';

const SIGNER = 'Q0000000000000000000000000000000000000000';

function payloadWith(fieldType: string, value: unknown): unknown {
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

describe('typed data deterministic resource limits', () => {
  it('rejects unsigned top-level and type-definition display fields', () => {
    const topLevelExtra = {
      ...(payloadWith('uint8', 1) as Record<string, unknown>),
      displayName: 'Approve harmless login',
    };
    expect(() => computeTypedDataDigest(topLevelExtra)).toThrow(/unknown top-level fields/);
    expect(SignTypedDataParamsSchema.safeParse([SIGNER, topLevelExtra]).success).toBe(false);

    const payload = payloadWith('uint8', 1) as {
      types: Record<string, Array<Record<string, unknown>>>;
    };
    const field = payload.types['Payload']?.[0];
    if (!field) throw new Error('test fixture is missing Payload.value');
    field['displayType'] = 'string';
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
