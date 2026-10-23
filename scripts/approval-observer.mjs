/** Observe from mount, including frames before the reader starts scrolling. */
export async function installApprovalObserver(page) {
  await page.evaluate(() => {
    const reviews = new WeakMap();
    const targets = new Map();
    const violations = [];
    window.__reviewProbeViolations = violations;
    // Use geometry from the observation itself. Removing a satisfied hint can
    // move tiles before the next observer callback runs. Current geometry is
    // independently checked at every destination by the scrolling reader.
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (
            entry.isIntersecting &&
            entry.intersectionRatio === 1 &&
            entry.boundingClientRect.width > 0 &&
            entry.boundingClientRect.height > 0 &&
            entry.intersectionRect.width === entry.boundingClientRect.width &&
            entry.intersectionRect.height === entry.boundingClientRect.height
          )
            targets.get(entry.target)?.seen.add(entry.target);
        }
      },
      { root: null, threshold: [1] },
    );
    const refresh = () => {
      for (const [tile] of targets) {
        if (!tile.isConnected) {
          observer.unobserve(tile);
          targets.delete(tile);
        }
      }
      const dialog = document.querySelector("[role=dialog]");
      if (!dialog) return;
      let review = reviews.get(dialog);
      if (!review) {
        review = { dialog, seen: new Set(), violations: [] };
        reviews.set(dialog, review);
      }
      window.__reviewProbeCoverage = review;
      for (const tile of dialog.querySelectorAll("[data-review-tile]")) {
        if (targets.has(tile)) continue;
        targets.set(tile, review);
        observer.observe(tile);
      }
    };
    new MutationObserver(refresh).observe(document.body, {
      childList: true,
      subtree: true,
    });
    const sample = () => {
      const review = window.__reviewProbeCoverage;
      if (review?.dialog.isConnected) {
        const button = [...review.dialog.querySelectorAll("button")].find(
          (element) =>
            [
              window.__approvalLabels.approve,
              window.__approvalLabels.connect,
            ].includes(element.textContent.trim()),
        );
        const unseen = [
          ...review.dialog.querySelectorAll("[data-review-tile]"),
        ].filter((tile) => !review.seen.has(tile));
        if (
          button &&
          !button.disabled &&
          unseen.length &&
          !review.violations.length
        ) {
          const violation = {
            unseen: unseen.length,
            text: unseen[0].parentElement.textContent.slice(0, 100),
          };
          review.violations.push(violation);
          violations.push(violation);
        }
      }
      requestAnimationFrame(sample);
    };
    refresh();
    requestAnimationFrame(sample);
  });
}
