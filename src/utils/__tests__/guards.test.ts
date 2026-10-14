import {
  describeUnknown,
  isArray,
  isObject,
  isObjectLike,
  isRecord,
  toError,
} from '../guards';
import {
  foreignErrorCases,
  errorShapedCases,
  malformedErrorMessages,
} from './errorFixtures';

// Class: normalization must satisfy callers that discriminate with instanceof Error.
it.each([...foreignErrorCases, ...errorShapedCases])(
  'normalizes $name to a local Error with serialized diagnostics',
  ({ create, normalizedMessage }) => {
    const value = create();
    expect(value).not.toBeInstanceOf(Error);
    const normalized = toError(value);
    expect(normalized).toBeInstanceOf(Error);
    expect(normalized).not.toBe(value);
    expect(normalized.name).toBe('Error');
    expect(normalized.message).toBe(normalizedMessage);
  }
);

it('normalizes objects with a spoofed Error tag as diagnostic values', () => {
  for (const value of [
    { [Symbol.toStringTag]: 'Error' },
    { code: 1, [Symbol.toStringTag]: 'Error' },
  ]) {
    const normalized = toError(value);
    expect(normalized).not.toBe(value);
    expect(normalized.message).toBe(JSON.stringify(value));
  }
});

it.each(malformedErrorMessages)('describes malformed Error.message as $text', ({ value, text }) => {
  expect(describeUnknown(Object.defineProperty(new Error(), 'message', { value }))).toBe(text);
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
