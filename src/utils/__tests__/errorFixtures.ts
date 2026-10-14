interface ErrorCase {
  name: string;
  create: () => unknown;
  normalizedMessage: string | null;
  description: string;
  message: string;
}

const inaccessible = (): never => {
  throw new Error('Inspection failed');
};

export const opaqueErrorCases: ErrorCase[] = [
  ...[
    { name: 'revoked object', target: {} },
    { name: 'revoked array', target: [] },
    { name: 'revoked function', target: () => undefined },
  ].map(({ name, target }) => ({
    name,
    create: () => {
      const { proxy, revoke } = Proxy.revocable(target, {});
      revoke();
      return proxy;
    },
    normalizedMessage: 'Unknown error',
    description: '[object]',
    message: 'Unknown error',
  })),
  {
    name: 'throwing prototype trap',
    create: () => new Proxy({}, { getPrototypeOf: inaccessible }),
    normalizedMessage: 'Unknown error',
    description: '[object]',
    message: 'Unknown error',
  },
  {
    name: 'throwing property trap',
    create: () => new Proxy({ code: 4001 }, { get: inaccessible }),
    normalizedMessage: 'Unknown error',
    description: '[object]',
    message: 'Unknown error',
  },
  {
    name: 'throwing membership trap',
    create: () => new Proxy({}, { has: inaccessible }),
    normalizedMessage: '{}',
    description: '{}',
    message: 'Unknown error',
  },
  {
    name: 'throwing enumeration trap',
    create: () => new Proxy({}, { ownKeys: inaccessible }),
    normalizedMessage: 'Unknown error',
    description: '[object]',
    message: '[object Object]',
  },
  {
    name: 'throwing JSON hook',
    create: () => ({ toJSON: inaccessible }),
    normalizedMessage: 'Unknown error',
    description: '[object]',
    message: '[object Object]',
  },
  {
    name: 'throwing JSON getter',
    create: () => Object.defineProperty({}, 'toJSON', { get: inaccessible }),
    normalizedMessage: 'Unknown error',
    description: '[object]',
    message: '[object Object]',
  },
  {
    name: 'throwing string coercion',
    create: () => ({ [Symbol.toPrimitive]: inaccessible }),
    normalizedMessage: '{}',
    description: '{}',
    message: 'Unknown error',
  },
  {
    name: 'Error with a throwing message getter',
    create: () => Object.defineProperty(new Error(), 'message', { get: inaccessible }),
    normalizedMessage: null,
    description: '[object]',
    message: 'Unknown error',
  },
];

// Provider errors can expose inherited fields, accessors, or proxy traps.
export const providerErrorShapes = [
  { name: 'object', create: () => ({}) },
  { name: 'Error', create: () => new Error() },
  { name: 'array', create: () => [] },
  { name: 'inherited object', create: () => ({}) },
  { name: 'proxy', create: () => new Proxy({}, {}) },
];

export function inspectedProviderError(
  shape: (typeof providerErrorShapes)[number],
  code: (read: number) => unknown,
  message: (read: number) => unknown
) {
  const reads = { code: 0, message: 0 };
  const fields = {
    code: { enumerable: true, get: () => code(++reads.code) },
    message: { enumerable: true, get: () => message(++reads.message) },
  };
  const value = shape.create();
  if (shape.name === 'inherited object') {
    Object.setPrototypeOf(value, Object.defineProperties({}, fields));
  } else {
    Object.defineProperties(value, fields);
  }
  return { value, reads };
}

export function firstReadOnly(value: unknown): (read: number) => unknown {
  return (read) => {
    if (read > 1) throw new Error('Error property expired');
    return value;
  };
}

export const singleReadErrorCases: ErrorCase[] = providerErrorShapes.map((shape) => {
  const serialized =
    shape.name === 'array'
      ? '[]'
      : shape.name === 'inherited object'
        ? '{}'
        : '{"code":-32601,"message":"failure"}';
  return {
    name: `${shape.name} with expiring getters`,
    create: () =>
      inspectedProviderError(shape, firstReadOnly(-32601), firstReadOnly('failure')).value,
    normalizedMessage: shape.name === 'Error' ? null : serialized,
    description: shape.name === 'Error' ? 'failure' : serialized,
    message: 'failure',
  };
});

export const malformedErrorMessages = [
  { value: 42, text: '42' },
  { value: null, text: 'null' },
  { value: undefined, text: 'undefined' },
  { value: Symbol('failure'), text: 'Symbol(failure)' },
  { value: {}, text: '[object Object]' },
];
