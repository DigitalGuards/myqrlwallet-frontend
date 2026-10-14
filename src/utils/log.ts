export default function log(message: string) {
  logger.log(`[LOG]: ${message}`);
}

function write(level: 'log' | 'warn' | 'error', values: unknown[]): void {
  console[level](...values);
}

/** Shared diagnostic sink. Keep message arguments and severity intact. */
export const logger = {
  log(...values: unknown[]): void {
    write('log', values);
  },
  warn(...values: unknown[]): void {
    write('warn', values);
  },
  error(...values: unknown[]): void {
    write('error', values);
  },
};
