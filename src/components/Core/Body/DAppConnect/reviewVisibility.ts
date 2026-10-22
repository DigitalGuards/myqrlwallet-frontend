/** Browser-only review coverage. Each tile covers at most 16 vertical CSS pixels. */
interface ReviewBlock {
  version: string;
  width: number;
  height: number;
  tiles: HTMLElement[];
  seen: Set<Element>;
  complete: boolean;
}

export function observeReview(
  root: HTMLElement,
  changed: (ready: boolean) => void,
) {
  const blocks = new Map<HTMLElement, ReviewBlock>();
  const owners = new Map<Element, ReviewBlock>();
  let disposed = false;

  const regions = () =>
    Array.from(root.querySelectorAll<HTMLElement>("[data-review-region]"));
  const hasArea = (element: HTMLElement) => {
    const rect = element.getBoundingClientRect();
    return rect.height > 0 && rect.width > 0 && element.clientHeight > 0;
  };
  const usable = () =>
    root.isConnected && hasArea(root) && regions().every(hasArea);
  const ready = () =>
    usable() &&
    blocks.size > 0 &&
    [...blocks.values()].every((block) => block.complete);

  // The implicit viewport root includes clipping by EVERY ancestor: the outer
  // dialog, its details region and nested message/data scrollers.
  const intersection = new IntersectionObserver(
    (entries) => {
      refresh();
      if (!usable()) return;
      for (const entry of entries) {
        const block = owners.get(entry.target);
        if (
          block &&
          entry.isIntersecting &&
          entry.intersectionRatio === 1 &&
          entry.boundingClientRect.height > 0 &&
          entry.boundingClientRect.width > 0
        ) {
          block.seen.add(entry.target);
          block.complete = block.seen.size === block.tiles.length;
        }
      }
      changed(ready());
    },
    { root: null, threshold: [1] },
  );

  const resize = new ResizeObserver(() => refresh());
  const mutations = new MutationObserver(() => refresh());

  function removeTiles(block: ReviewBlock) {
    for (const tile of block.tiles) {
      intersection.unobserve(tile);
      owners.delete(tile);
      tile.remove();
    }
  }

  function refresh() {
    if (disposed) return false;
    for (const region of regions()) {
      // Preserve fitted English bounds, including reviews shorter than 128px.
      // Longer reviews retain 128px even when the outer dialog must scroll.
      const first = region.firstElementChild;
      const last = region.lastElementChild;
      if (first && last) {
        const style = getComputedStyle(region);
        const contentHeight =
          last.getBoundingClientRect().bottom -
          first.getBoundingClientRect().top +
          (parseFloat(style.paddingTop) || 0) +
          (parseFloat(style.paddingBottom) || 0);
        const minimum = `${Math.min(128, contentHeight)}px`;
        if (region.style.minHeight !== minimum)
          region.style.minHeight = minimum;
      }
      resize.observe(region);
    }
    const elements = new Set(
      root.querySelectorAll<HTMLElement>("[data-review-block]"),
    );
    for (const [element, block] of blocks) {
      if (!elements.has(element)) {
        removeTiles(block);
        resize.unobserve(element);
        blocks.delete(element);
      }
    }
    for (const element of elements) {
      const version = `${element.textContent}\n${element.dataset["reviewValue"] ?? ""}`;
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      const width = Math.max(
        0,
        Math.min(
          element.clientWidth,
          rect.width -
            (parseFloat(style.borderLeftWidth) || 0) -
            (parseFloat(style.borderRightWidth) || 0),
        ),
      );
      const height =
        element.scrollHeight > element.clientHeight
          ? element.scrollHeight
          : Math.max(
              0,
              rect.height -
                (parseFloat(style.borderTopWidth) || 0) -
                (parseFloat(style.borderBottomWidth) || 0),
            );
      const old = blocks.get(element);
      if (
        old?.version === version &&
        (old.complete || (old.width === width && old.height === height))
      )
        continue;
      if (old) removeTiles(old);
      const block: ReviewBlock = {
        version,
        width,
        height,
        tiles: [],
        seen: new Set(),
        complete: false,
      };
      blocks.set(element, block);
      resize.observe(element);
      // Zero-size content remains an unmet requirement. It never gets a
      // zero-area sentinel, which Chromium could report as fully intersecting.
      if (width <= 0 || height <= 0) continue;
      for (let top = 0; top < height; top += 16) {
        const tile = document.createElement("span");
        tile.dataset["reviewTile"] = "";
        tile.setAttribute("aria-hidden", "true");
        // Overlap the last slice when necessary so every target is >= 1px.
        const tileHeight = Math.max(1, Math.min(16, height - top));
        tile.style.cssText = `position:absolute;pointer-events:none;left:0;top:${Math.max(0, Math.min(top, height - tileHeight))}px;width:${width}px;height:${tileHeight}px;`;
        element.append(tile);
        block.tiles.push(tile);
        owners.set(tile, block);
        intersection.observe(tile);
      }
    }
    const result = ready();
    changed(result);
    return result;
  }

  resize.observe(root);
  mutations.observe(root, {
    childList: true,
    characterData: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["data-review-value"],
  });
  refresh();
  return {
    refresh,
    dispose() {
      disposed = true;
      mutations.disconnect();
      resize.disconnect();
      intersection.disconnect();
      for (const block of blocks.values()) removeTiles(block);
      blocks.clear();
    },
  };
}
