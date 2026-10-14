import { afterEach, expect, it, jest } from '@jest/globals';
import log, { logger } from '../log';

afterEach(() => {
  jest.restoreAllMocks();
});

it.each(['log', 'warn', 'error'] as const)(
  'preserves %s severity and diagnostic arguments',
  (level) => {
    const sink = jest.spyOn(console, level).mockImplementation(() => undefined);
    const error = new Error('Failure detail');
    logger[level]('Message:', error, 42);
    expect(sink).toHaveBeenCalledWith('Message:', error, 42);
  },
);

it('retains the existing log prefix', () => {
  const sink = jest.spyOn(console, 'log').mockImplementation(() => undefined);
  log('Legacy message');
  expect(sink).toHaveBeenCalledWith('[LOG]: Legacy message');
});
