export default function log(message: string) {
  logInfo(`[LOG]: ${message}`);
}

function writeLog(level: 'log' | 'warn' | 'error', message: string, details: unknown[]): void {
  console[level](message, ...details);
}

/** Preserve diagnostic levels and structured details at the logging boundary. */
export function logInfo(message: string, ...details: unknown[]): void {
  writeLog('log', message, details);
}

export function logWarning(message: string, ...details: unknown[]): void {
  writeLog('warn', message, details);
}

export function logError(message: string, ...details: unknown[]): void {
  writeLog('error', message, details);
}
