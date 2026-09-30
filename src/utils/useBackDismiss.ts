import { useEffect, useRef } from "react";
import { registerBackDismiss } from "./nativeBack";

/**
 * Let Android's back button close this overlay.
 *
 * Register from any modal, sheet, drawer or picker while it is open. `dismiss`
 * must be the overlay's own close path, so back behaves exactly like its X
 * button: an approval or signing sheet cancels or rejects, and can never
 * approve.
 *
 * Return false from `dismiss` to decline, which passes back down to the next
 * overlay and then to route navigation.
 */
export function useBackDismiss(
  isOpen: boolean,
  dismiss: () => boolean | void,
): void {
  // Kept in a ref so a new closure on every render does not re-register the
  // overlay and quietly move it to the top of the stack.
  const latest = useRef(dismiss);
  useEffect(() => {
    latest.current = dismiss;
  }, [dismiss]);

  useEffect(() => {
    if (!isOpen) return;
    return registerBackDismiss(() => latest.current() !== false);
  }, [isOpen]);
}
