import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { observeReview } from "./reviewVisibility";

export function useReviewVisibility(reviewKey: string) {
  const [ready, setReady] = useState(false);
  const [element, ref] = useState<HTMLDivElement | null>(null);
  const controller = useRef<ReturnType<typeof observeReview> | null>(null);
  useLayoutEffect(() => {
    // Keep the request identity in the effect dependency: a replacement URI
    // or request starts a new review even when all displayed values match.
    if (!element || !reviewKey) return;
    if (
      typeof IntersectionObserver === "undefined" ||
      typeof ResizeObserver === "undefined"
    )
      return;
    const current = observeReview(element, setReady);
    controller.current = current;
    return () => {
      current.dispose();
      controller.current = null;
    };
  }, [element, reviewKey]);
  // Reconcile changed values before paint; the action guard also reconciles
  // synchronously so it cannot use a stale enabled render or queued IO entry.
  useLayoutEffect(() => {
    controller.current?.refresh();
  });
  const canApprove = useCallback(
    () => controller.current?.refresh() ?? false,
    [],
  );
  return { ref, ready, canApprove };
}
