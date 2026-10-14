declare const __QRL_DIAGNOSTICS__: boolean | undefined;

type DiagnosticLevel = 'log' | 'info' | 'warn' | 'error';

// Production builds remove diagnostics and their lazy argument expressions.
const diagnosticsEnabled = typeof __QRL_DIAGNOSTICS__ === 'undefined' || __QRL_DIAGNOSTICS__;

function write(level: DiagnosticLevel, values: () => unknown[]): void {
  if (!diagnosticsEnabled) return;
  console[level](...values());
}

/** Shared synchronous diagnostic boundary with lazy argument evaluation. */
export const logger = {
  write,
  log(...values: unknown[]): void {
    write('log', () => values);
  },
  info(...values: unknown[]): void {
    write('info', () => values);
  },
  warn(...values: unknown[]): void {
    write('warn', () => values);
  },
  error(...values: unknown[]): void {
    write('error', () => values);
  },
};

export default function log(message: string) {
  logger.log(`[LOG]: ${message}`);
}
