import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { observeReview } from "./reviewVisibility";

export function useReviewVisibility(generation: number) {
  const [coverage, setCoverage] = useState({ generation, ready: false });
  const [element, ref] = useState<HTMLDivElement | null>(null);
  const controller = useRef<{ generation: number; review: ReturnType<typeof observeReview> } | null>(null);
  useLayoutEffect(() => {
    // Keep the request identity in the effect dependency: a replacement URI
    // or request starts a new review even when all displayed values match.
    if (!element) return;
    if (
      typeof IntersectionObserver === "undefined" ||
      typeof ResizeObserver === "undefined"
    )
      return;
    const current = observeReview(element, (ready) => {
      setCoverage((previous) => previous.generation === generation && previous.ready === ready
        ? previous : { generation, ready });
    });
    controller.current = { generation, review: current };
    return () => {
      current.dispose();
      controller.current = null;
    };
  }, [element, generation]);
  // Reconcile changed values before paint; the action guard also reconciles
  // synchronously so it cannot use a stale enabled render or queued IO entry.
  useLayoutEffect(() => {
    controller.current?.review.refresh();
  });
  const canApprove = useCallback(
    () => controller.current?.generation === generation && controller.current.review.refresh(),
    [generation],
  );
  return { ref, ready: coverage.generation === generation && coverage.ready, canApprove };
}
