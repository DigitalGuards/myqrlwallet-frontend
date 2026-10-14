/**
 * Error-narrowing helpers for `catch (error)` blocks.
 *
 * With `strict` (and `useUnknownInCatchVariables`), caught values are typed
 * `unknown`. These helpers replace the previous `catch (error: any)` pattern
 * with honest narrowing while preserving observable property reads.
 */
import { isObject } from "./guards";

/** Best-effort human-readable message from an unknown thrown value. */
export function getErrorMessage(error: unknown): string {
  try {
    if (error instanceof Error) {
      const message: unknown = error.message;
      return typeof message === "string" ? message : String(message);
    }
    if (typeof error === "string") return error;
    if (
      typeof error === "object" &&
      error !== null &&
      "message" in error &&
      typeof error.message === "string"
    ) {
      // The validation and return reads can produce different valid strings.
      const message: unknown = error.message;
      return typeof message === "string" ? message : String(message);
    }
    return String(error);
  } catch {
    return "Unknown error";
  }
}

/** Read an EIP-1193 code once, preserving the result of an untrusted accessor. */
export function getProviderErrorCode(error: unknown): number | undefined {
  try {
    if (!isObject(error) || !("code" in error || "message" in error))
      return undefined;
    const code = error["code"];
    return typeof code === "number" ? code : undefined;
  } catch {
    return undefined;
  }
}
