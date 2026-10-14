import { Script } from 'node:vm';
import { isObject } from '../guards';

function foreignError(): object {
  const value: unknown = new Script('new Error()').runInNewContext();
  if (!isObject(value)) throw new Error('Expected a foreign-realm error');
  return value;
}

// Class: cleanup failures carry Error identity and diagnostics across realms.
export const foreignErrorCases = [
  ...['Error', 'EvalError', 'RangeError', 'ReferenceError', 'SyntaxError', 'TypeError', 'URIError'].map(
    (errorName) => ({
      name: `foreign-realm ${errorName}`,
      errorName,
      source: `new ${errorName}("credential storage unavailable")`,
      message: 'credential storage unavailable',
    })
  ),
  {
    name: 'foreign-realm AggregateError',
    errorName: 'AggregateError',
    source: 'new AggregateError([new TypeError("storage")], "credential storage unavailable")',
    message: 'credential storage unavailable',
  },
  {
    name: 'foreign-realm Error with a cause',
    errorName: 'Error',
    source: 'new Error("credential storage unavailable", { cause: new TypeError("storage") })',
    message: 'credential storage unavailable',
  },
  {
    name: 'foreign-realm Error subclass',
    errorName: 'CredentialStorageError',
    source: `new (class extends TypeError {
      constructor() {
        super("credential storage unavailable");
        this.name = "CredentialStorageError";
        this.code = "storage_unavailable";
      }
    })()`,
    message: 'credential storage unavailable',
  },
  {
    name: 'foreign-realm Error with an empty message',
    errorName: 'Error',
    source: 'new Error()',
    message: '',
  },
].map(({ source, ...fixture }) => ({
  ...fixture,
  create: (): unknown => new Script(source).runInNewContext(),
  normalizedMessage: fixture.message,
}));

export const errorShapedCases = [
  {
    name: 'error-shaped object',
    create: () => ({ name: 'InvalidStateError', message: 'storage unavailable' }),
    normalizedMessage: '{"name":"InvalidStateError","message":"storage unavailable"}',
  },
  {
    name: 'error-shaped object with an Error tag',
    create: () => ({
      [Symbol.toStringTag]: 'Error', name: 'TypeError', message: 'storage unavailable',
    }),
    normalizedMessage: '{"name":"TypeError","message":"storage unavailable"}',
  },
  {
    name: 'error-shaped array',
    create: () => Object.assign([], { name: 'Error', message: 'storage unavailable' }),
    normalizedMessage: '[]',
  },
  {
    name: 'error-shaped boxed primitive',
    create: () => {
      const boxed: unknown = Object('failure');
      if (!isObject(boxed)) throw new Error('Expected a boxed string');
      return Object.assign(boxed, { name: 'Error', message: 'storage unavailable' });
    },
    normalizedMessage: '"failure"',
  },
];

export const browserErrorCases = [
  {
    name: 'browser DOMException',
    create: () => new DOMException('The database connection is closing.', 'InvalidStateError'),
  },
  {
    name: 'foreign-window DOMException',
    create: () => {
      const iframe = document.createElement('iframe');
      document.body.append(iframe);
      const realm = iframe.contentDocument?.defaultView;
      if (!realm) throw new Error('Missing iframe window');
      return new realm.DOMException('The database connection is closing.', 'InvalidStateError');
    },
  },
];

export const providerErrorShapes = [
  { name: 'object', create: () => ({}) },
  { name: 'Error', create: () => new Error() },
  { name: 'array', create: () => [] },
  { name: 'inherited object', create: () => ({}) },
  { name: 'foreign-realm Error', create: foreignError },
];

export function providerError(
  shape: (typeof providerErrorShapes)[number],
  code: unknown,
  message: unknown
) {
  const value = shape.create();
  if (shape.name === 'inherited object') {
    Object.setPrototypeOf(value, { code, message });
  } else {
    Object.assign(value, { code, message });
  }
  return value;
}

export const malformedErrorMessages = [
  { value: 42, text: '42' },
  { value: null, text: 'null' },
  { value: undefined, text: 'undefined' },
  { value: Symbol('failure'), text: 'Symbol(failure)' },
  { value: {}, text: '[object Object]' },
];
