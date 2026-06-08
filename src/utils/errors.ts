/**
 * Error-narrowing helpers for `catch (error)` blocks.
 *
 * With `strict` (and `useUnknownInCatchVariables`), caught values are typed
 * `unknown`. These helpers replace the previous `catch (error: any)` pattern
 * with honest narrowing: derive a display message, or guard the EIP-1193
 * provider error shape (`{ code?, message? }`) before reading `code`/`message`.
 */

/** Best-effort human-readable message from an unknown thrown value. */
export function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  if (
    typeof error === "object" &&
    error !== null &&
    "message" in error &&
    typeof (error as { message: unknown }).message === "string"
  ) {
    return (error as { message: string }).message;
  }
  return String(error);
}

/** EIP-1193 provider error: carries a numeric `code` (e.g. 4001 = user reject). */
export interface ProviderRpcError {
  code?: number;
  message?: string;
}

/** Type guard for an EIP-1193-shaped error before reading `code`/`message`. */
export function isProviderRpcError(error: unknown): error is ProviderRpcError {
  return (
    typeof error === "object" &&
    error !== null &&
    ("code" in error || "message" in error)
  );
}
