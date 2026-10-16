/** @jest-environment jsdom */

import { getErrorMessage } from '../errors';
import { describeUnknown, toError } from '../guards';
import { malformedErrorMessages } from './errorFixtures';

const message = 'credential storage unavailable';
const realmCases = [
  { constructor: 'Error', name: 'Error' },
  { constructor: 'DOMException', name: 'InvalidStateError' },
] as const;

function iframeError(constructor: 'Error' | 'DOMException'): Error | DOMException {
  const iframe = document.createElement('iframe');
  document.body.append(iframe);
  try {
    const realm = iframe.contentDocument?.defaultView;
    if (!realm) throw new Error('Missing iframe window');
    return constructor === 'Error'
      ? new realm.Error(message)
      : new realm.DOMException(message, 'InvalidStateError');
  } finally {
    iframe.remove();
  }
}

describe.each(realmCases)('iframe $constructor', ({ constructor, name }) => {
  it('preserves diagnostics in every normalizer', () => {
    const failure = iframeError(constructor);
    expect(failure).not.toBeInstanceOf(Error);
    expect(failure).not.toBeInstanceOf(DOMException);
    expect(JSON.stringify(failure)).toBe('{}');

    const normalized = toError(failure);
    expect(normalized).toBeInstanceOf(Error);
    expect(normalized).not.toBe(failure);
    expect(normalized).toMatchObject({ name, message });
    expect(describeUnknown(failure)).toBe(message);
    expect(getErrorMessage(failure)).toBe(message);
    expect(failure.name).toBe(name);
    expect(failure.message).toBe(message);
  });

  it('keeps an empty message', () => {
    const failure = Object.defineProperty(iframeError(constructor), 'message', { value: '' });
    expect(toError(failure).message).toBe('');
    expect(describeUnknown(failure)).toBe('');
    expect(getErrorMessage(failure)).toBe('');
  });

  it.each(malformedErrorMessages)('retains serialization for a $text message', ({ value }) => {
    const failure = Object.defineProperty(iframeError(constructor), 'message', { value });
    expect(toError(failure)).toMatchObject({ name: 'Error', message: '{}' });
    expect(describeUnknown(failure)).toBe('{}');
  });

  it.each(malformedErrorMessages)('uses the default name for a $text name', ({ value }) => {
    const failure = Object.defineProperty(iframeError(constructor), 'name', { value });
    expect(toError(failure)).toMatchObject({ name: 'Error', message });
    expect(describeUnknown(failure)).toBe(message);
  });

  it.each(['name', 'message'])('contains a throwing %s getter', (key) => {
    const read = jest.fn(() => { throw new Error('unreadable diagnostic'); });
    const failure = Object.defineProperty(iframeError(constructor), key, { get: read });
    expect(toError(failure)).toMatchObject({ name: 'Error', message: '{}' });
    expect(describeUnknown(failure)).toBe('{}');
    expect(read).toHaveBeenCalledTimes(2);
  });

  it('reads each diagnostic once per normalization', () => {
    const failure = iframeError(constructor);
    const readMessage = jest.fn(() => message);
    const readName = jest.fn(() => name);
    Object.defineProperties(failure, {
      message: { get: readMessage },
      name: { get: readName },
    });
    expect(toError(failure)).toMatchObject({ name, message });
    expect(readMessage).toHaveBeenCalledTimes(1);
    expect(readName).toHaveBeenCalledTimes(1);
  });
});

it.each([
  new Error(message),
  new TypeError(message),
  new DOMException(message, 'InvalidStateError'),
])('preserves the identity and diagnostics of a same-realm %s', (failure) => {
  expect(toError(failure)).toBe(failure);
  expect(describeUnknown(failure)).toBe(message);
  expect(getErrorMessage(failure)).toBe(message);
});

it.each(['Error', 'DOMException'])('retains JSON for a plain object tagged %s', (tag) => {
  const value = { [Symbol.toStringTag]: tag, name: 'Error', message };
  const serialized = '{"name":"Error","message":"credential storage unavailable"}';
  expect(toError(value)).toMatchObject({ name: 'Error', message: serialized });
  expect(describeUnknown(value)).toBe(serialized);
  expect(getErrorMessage(value)).toBe(message);
});

it('retains serialization when tag inspection throws', () => {
  const value = Object.defineProperty({ code: 1 }, Symbol.toStringTag, {
    get: () => { throw new Error('unreadable tag'); },
  });
  expect(toError(value).message).toBe('{"code":1}');
  expect(describeUnknown(value)).toBe('{"code":1}');
});
