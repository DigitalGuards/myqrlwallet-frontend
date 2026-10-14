import { afterEach, expect, it, jest } from '@jest/globals';
import log, { logger } from '../log';

afterEach(() => {
  jest.restoreAllMocks();
});

it.each(['log', 'info', 'warn', 'error'] as const)(
  'preserves %s severity and diagnostic arguments',
  (level) => {
    const sink = jest.spyOn(console, level).mockImplementation(() => undefined);
    const error = new Error('Failure detail');
    logger[level]('Message:', error, 42);
    expect(sink).toHaveBeenCalledWith('Message:', error, 42);
    expect(sink.mock.contexts).toEqual([console]);
  }
);

it('retains the existing log prefix', () => {
  const sink = jest.spyOn(console, 'log').mockImplementation(() => undefined);
  log('Legacy message');
  expect(sink).toHaveBeenCalledWith('[LOG]: Legacy message');
});

it.each(['log', 'info', 'warn', 'error'] as const)(
  'preserves empty and opaque %s arguments without inspecting them',
  (level) => {
    const sink = jest.spyOn(console, level).mockImplementation(() => undefined);
    const opaque = new Proxy(
      {},
      {
        get() {
          throw new Error('Argument inspected');
        },
      }
    );
    const values = [undefined, null, false, 1n, Symbol('diagnostic'), opaque];
    logger[level]();
    logger[level](...values);
    expect(sink.mock.calls[0]).toEqual([]);
    const forwarded = sink.mock.calls[1];
    expect(forwarded).toHaveLength(values.length);
    values.forEach((value, index) => {
      expect(forwarded?.[index] === value).toBe(true);
    });
  }
);

it.each(['log', 'info', 'warn', 'error'] as const)(
  'preserves a failing %s sink and resolves the current method on every call',
  (level) => {
    const failure = new Error('Sink failed');
    const sink = jest.spyOn(console, level).mockImplementation(() => {
      throw failure;
    });
    expect(() => {
      logger[level]('first');
    }).toThrow(failure);
    sink.mockImplementation(() => undefined);
    logger[level]('second');
    expect(sink).toHaveBeenLastCalledWith('second');
    expect(sink.mock.contexts).toEqual([console, console]);
  }
);

const diagnosticEntrypoints = [
  ...(['log', 'info', 'warn', 'error'] as const).map((level) => ({
    name: level,
    level,
    write: (message: string) => {
      logger[level](message);
    },
    message: 'diagnostic',
  })),
  ...(['log', 'info', 'warn', 'error'] as const).map((level) => ({
    name: `lazy ${level}`,
    level,
    write: (message: string) => {
      logger.write(level, () => [message]);
    },
    message: 'diagnostic',
  })),
  { name: 'prefixed log', level: 'log' as const, write: log, message: '[LOG]: diagnostic' },
];

// Class: moving diagnostics behind a shared boundary can change method lookup,
// the receiver, synchronous ordering, return values, or thrown error identity.
it.each(diagnosticEntrypoints)(
  'preserves synchronous sink lookup and completion through $name',
  ({ level, write, message }) => {
    const descriptor = Object.getOwnPropertyDescriptor(console, level);
    if (!descriptor) throw new Error('Console method descriptor is missing');
    const events: string[] = [];
    const invoke = jest.fn(write);
    let reads = 0;
    Object.defineProperty(console, level, {
      configurable: true,
      get() {
        reads += 1;
        const call = reads;
        events.push(`lookup ${call}`);
        return function (this: Console, ...values: unknown[]) {
          expect(this).toBe(console);
          expect(values).toEqual([message]);
          events.push(`write ${call}`);
          return 'sink return value';
        };
      },
    });
    try {
      invoke('diagnostic');
      events.push('between');
      invoke('diagnostic');
      events.push('after');
      expect(invoke.mock.results).toEqual([
        { type: 'return', value: undefined },
        { type: 'return', value: undefined },
      ]);
      expect(events).toEqual(['lookup 1', 'write 1', 'between', 'lookup 2', 'write 2', 'after']);
    } finally {
      Object.defineProperty(console, level, descriptor);
    }
  }
);

it.each(['log', 'info', 'warn', 'error'] as const)(
  'preserves sink lookup before lazy %s argument evaluation',
  (level) => {
    const events: string[] = [];
    const descriptor = Object.getOwnPropertyDescriptor(console, level);
    if (!descriptor) throw new Error('Console method descriptor is missing');
    const sink = jest.fn();
    Object.defineProperty(console, level, {
      configurable: true,
      get() {
        events.push('method');
        return sink;
      },
    });
    try {
      logger.write(level, () => {
        events.push('arguments');
        return ['message'];
      });
      expect(events).toEqual(['method', 'arguments']);
      expect(sink).toHaveBeenCalledWith('message');
      expect(sink.mock.contexts[0] === console).toBe(true);
    } finally {
      Object.defineProperty(console, level, descriptor);
    }
  }
);

it.each(['log', 'info', 'warn', 'error'] as const)(
  'propagates a lazy %s argument failure before invoking the console method',
  (level) => {
    const sink = jest.spyOn(console, level).mockImplementation(() => undefined);
    const failure = new Error('Expired diagnostic value');
    const argumentsForLog = jest.fn(() => {
      throw failure;
    });
    expect(() => {
      logger.write(level, argumentsForLog);
    }).toThrow(failure);
    expect(argumentsForLog).toHaveBeenCalledTimes(1);
    expect(sink).not.toHaveBeenCalled();
  }
);

it.each(diagnosticEntrypoints)(
  'propagates the exact synchronous sink failure through $name',
  ({ level, write }) => {
    const failure = new Error('Diagnostic sink failure');
    const sink = jest.spyOn(console, level).mockImplementation(() => {
      throw failure;
    });
    let completed = false;
    let caught: unknown;
    try {
      write('diagnostic');
      completed = true;
    } catch (error) {
      caught = error;
    }
    expect(completed).toBe(false);
    expect(caught).toBe(failure);
    expect(sink).toHaveBeenCalledTimes(1);
  }
);
