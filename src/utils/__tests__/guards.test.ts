import {
  describeUnknown,
  isArray,
  isObject,
  isObjectLike,
  isRecord,
  toError,
  toBigInt,
  toTemplateString,
} from '../guards';
import {
  foreignErrorCases,
  errorShapedCases,
  malformedErrorMessages,
} from './errorFixtures';

// Class: normalization must satisfy callers that discriminate with instanceof Error.
it.each(foreignErrorCases)(
  'normalizes $name to a local Error with its original diagnostics',
  ({ create, errorName, message }) => {
    const value = create();
    expect(value).not.toBeInstanceOf(Error);
    const normalized = toError(value);
    expect(normalized).toBeInstanceOf(Error);
    expect(normalized).not.toBe(value);
    expect(normalized.name).toBe(errorName);
    expect(normalized.message).toBe(message);
    expect(describeUnknown(value)).toBe(message);
  }
);

it.each(errorShapedCases)(
  'normalizes $name to a local Error with serialized diagnostics',
  ({ create, normalizedMessage }) => {
    const value = create();
    expect(value).not.toBeInstanceOf(Error);
    const normalized = toError(value);
    expect(normalized).toBeInstanceOf(Error);
    expect(normalized).not.toBe(value);
    expect(normalized.name).toBe('Error');
    expect(normalized.message).toBe(normalizedMessage);
    expect(describeUnknown(value)).toBe(normalizedMessage);
  }
);

it('normalizes objects with a spoofed Error tag as diagnostic values', () => {
  for (const value of [
    { [Symbol.toStringTag]: 'Error' },
    { code: 1, [Symbol.toStringTag]: 'Error' },
    { [Symbol.toStringTag]: 'DOMException', name: 'InvalidStateError', message: 'storage unavailable' },
  ]) {
    const normalized = toError(value);
    expect(normalized).not.toBe(value);
    expect(normalized.message).toBe(JSON.stringify(value));
    expect(describeUnknown(value)).toBe(JSON.stringify(value));
  }
});

it.each(malformedErrorMessages)('describes malformed Error.message as $text', ({ value, text }) => {
  const error = Object.defineProperty(new Error(), 'message', { value });
  expect(toError(error)).toBe(error);
  expect(describeUnknown(error)).toBe(text);
});

it('narrows records and arrays separately', () => {
  for (const value of [null, undefined, true, 'text', 1, () => undefined]) {
    expect(isRecord(value)).toBe(false);
    expect(isArray(value)).toBe(false);
  }
  expect(isRecord({ field: null })).toBe(true);
  expect(isRecord([])).toBe(false);
  expect(isArray([null, { field: 1 }])).toBe(true);
  expect(isArray({ length: 0 })).toBe(false);
});

it('preserves object and callable property containers', () => {
  for (const value of [null, undefined, true, 'text', 1, 1n, Symbol('value')]) {
    expect(isObject(value)).toBe(false);
    expect(isObjectLike(value)).toBe(false);
  }
  for (const value of [{}, [], Object(1n), Object('text')]) {
    expect(isObject(value)).toBe(true);
    expect(isObjectLike(value)).toBe(true);
  }
  const callable = () => undefined;
  expect(isObject(callable)).toBe(false);
  expect(isObjectLike(callable)).toBe(true);
});

it('preserves Error identity and serializable diagnostic values', () => {
  const error = new Error('original');
  expect(toError(error)).toBe(error);
  expect(toError('failure').message).toBe('failure');
  expect(toError({ code: 1 }).message).toBe('{"code":1}');
  expect(toError(null).message).toBe('null');
  expect(describeUnknown(error)).toBe('original');
  expect(describeUnknown('failure')).toBe('failure');
  expect(describeUnknown({ code: 1 })).toBe('{"code":1}');
});

it('retains fallbacks when JSON serialization returns undefined', () => {
  for (const value of [undefined, Symbol('test'), () => undefined, { toJSON: () => undefined }]) {
    expect(toError(value).message).toBe('Unknown error');
  }
  expect(describeUnknown({ toJSON: () => undefined })).toBe('');
});

it('retains fallbacks for values JSON cannot serialize', () => {
  const circular: Record<string, unknown> = {};
  circular['self'] = circular;
  expect(toError(circular).message).toBe('Unknown error');
  expect(describeUnknown(circular)).toBe('[object]');
  expect(toError(1n).message).toBe('Unknown error');
  expect(describeUnknown(1n)).toBe('1');
});


it.each([
  [0, 0n], [1250, 1250n], [-1250, -1250n],
  [1250n, 1250n], ['1250', 1250n], ['0x4e2', 1250n],
  [true, 1n], [false, 0n], ['', 0n], ['  ', 0n],
  [Object(1250n), 1250n], [Object('0x4e2'), 1250n],
  [[1250], 1250n], [[], 0n],
])('converts unknown numeric input %p to %p', (value, expected) => {
  expect(toBigInt(value)).toBe(expected);
});

it('coerces a numeric object once with the number hint', () => {
  const primitive = jest.fn((hint: string) => {
    expect(hint).toBe('number');
    return '0x4e2';
  });
  expect(toBigInt({ [Symbol.toPrimitive]: primitive })).toBe(1250n);
  expect(primitive).toHaveBeenCalledTimes(1);
});

it.each([null, undefined, Symbol('balance')])(
  'keeps the BigInt TypeError for %p', (value) => {
    expect(() => toBigInt(value)).toThrow(TypeError);
  },
);
it.each([1.5, NaN, Infinity])('keeps the BigInt RangeError for %p', (value) => {
  expect(() => toBigInt(value)).toThrow(RangeError);
});
it.each(['invalid', {}])('keeps the BigInt SyntaxError for %p', (value) => {
  expect(() => toBigInt(value)).toThrow(SyntaxError);
});
it('propagates the exact numeric coercion failure', () => {
  const failure = new Error('coercion failed');
  expect(() => toBigInt({ valueOf: () => { throw failure; } })).toThrow(failure);
});

it.each([
  [null, 'null'], [undefined, 'undefined'], [23, '23'], [23n, '23'],
  [false, 'false'], [{}, '[object Object]'], [[1, null, 2], '1,,2'],
  [new Error('failure'), 'Error: failure'],
])('retains template text for %p', (value, expected) => {
  expect(toTemplateString(value)).toBe(expected);
});
it('coerces template objects once with the string hint', () => {
  const primitive = jest.fn((hint: string) => {
    expect(hint).toBe('string');
    return 'failure';
  });
  expect(toTemplateString({ [Symbol.toPrimitive]: primitive })).toBe('failure');
  expect(primitive).toHaveBeenCalledTimes(1);
});
it.each([Symbol('failure'), { [Symbol.toPrimitive]: () => Symbol('failure') }])(
  'retains template conversion errors for symbols', (value) => {
    expect(() => toTemplateString(value)).toThrow(TypeError);
  },
);
