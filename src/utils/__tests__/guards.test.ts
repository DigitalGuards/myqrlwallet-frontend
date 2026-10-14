import { describeUnknown, isArray, isRecord, toError } from '../guards';
import { malformedErrorMessages, opaqueErrorCases, singleReadErrorCases } from './errorFixtures';

it.each([...opaqueErrorCases, ...singleReadErrorCases])(
  'normalizes $name without throwing',
  ({ create, normalizedMessage }) => {
    const value = create();
    const normalized = toError(value);
    if (normalizedMessage === null) expect(normalized).toBe(value);
    else expect(normalized.message).toBe(normalizedMessage);
  }
);

it.each([...opaqueErrorCases, ...singleReadErrorCases])(
  'describes $name without throwing',
  ({ create, description }) => {
    expect(describeUnknown(create())).toBe(description);
  }
);

it.each(malformedErrorMessages)('describes malformed Error.message as $text', ({ value, text }) => {
  const getter = jest
    .fn()
    .mockImplementationOnce(() => value)
    .mockImplementation(() => {
      throw new Error('Message expired');
    });
  expect(describeUnknown(Object.defineProperty(new Error(), 'message', { get: getter }))).toBe(
    text
  );
  expect(getter).toHaveBeenCalledTimes(1);
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
