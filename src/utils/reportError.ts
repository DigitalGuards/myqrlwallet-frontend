import { describeUnknown } from "./guards";
import log from "./log";

/** Send caught failures through the application's diagnostic logger. */
export function reportError(message: string, error: unknown): void {
  log(`${message} ${describeUnknown(error)}`);
}
