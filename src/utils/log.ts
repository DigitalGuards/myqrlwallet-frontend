export default function log(message: string) {
  logger.log(`[LOG]: ${message}`);
}

function write(
  level: "log" | "info" | "warn" | "error",
  values: unknown[],
): void {
  console[level](...values);
}

/** Shared diagnostic sink. Keep message arguments and severity intact. */
export const logger = {
  log(...values: unknown[]): void {
    write("log", values);
  },
  info(...values: unknown[]): void {
    write("info", values);
  },
  warn(...values: unknown[]): void {
    write("warn", values);
  },
  error(...values: unknown[]): void {
    write("error", values);
  },
};

/** Preserve diagnostic levels and structured details at the logging boundary. */
export function logInfo(message: string, ...details: unknown[]): void {
  logger.log(message, ...details);
}

export function logWarning(message: string, ...details: unknown[]): void {
  logger.warn(message, ...details);
}

export function logError(message: string, ...details: unknown[]): void {
  logger.error(message, ...details);
}
