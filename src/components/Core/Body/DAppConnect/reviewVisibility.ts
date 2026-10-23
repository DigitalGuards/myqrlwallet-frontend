/** Browser-only review coverage. Each tile covers at most 16 vertical CSS pixels. */
interface ReviewBlock {
  version: string;
  width: number;
  height: number;
  overflowing: boolean;
  tiles: HTMLElement[];
  seen: Set<Element>;
  complete: boolean;
}

function overflowsHorizontally(element: HTMLElement, descendants: Element[]) {
  const rect = element.getBoundingClientRect();
  const style = getComputedStyle(element);
  const blockLeft = rect.left + (parseFloat(style.borderLeftWidth) || 0);
  const blockRight = rect.right - (parseFloat(style.borderRightWidth) || 0);
  let left = Math.max(0, blockLeft);
  let right = Math.min(window.innerWidth, blockRight);
  for (let parent = element.parentElement; parent; parent = parent.parentElement) {
    const style = getComputedStyle(parent);
    if (/(auto|scroll|hidden|clip)/.test(style.overflowX)) {
      const box = parent.getBoundingClientRect();
      left = Math.max(left, box.left + (parseFloat(style.borderLeftWidth) || 0));
      right = Math.min(right, box.right - (parseFloat(style.borderRightWidth) || 0));
    }
  }
  if (element.scrollWidth > element.clientWidth || blockLeft < left - 0.02 || blockRight > right + 0.02)
    return true;
  return descendants.some((child) => {
    if (child.scrollWidth > child.clientWidth) return true;
    // Ignore unpainted descendants, such as a closed optional disclosure.
    // Inline descendants can have several line fragments and no clientWidth.
    const box = child.getBoundingClientRect();
    return box.width > 0 && (box.left < left - 0.02 || box.right > right + 0.02);
  });
}

export function observeReview(
  root: HTMLElement,
  changed: (ready: boolean) => void,
) {
  const blocks = new Map<HTMLElement, ReviewBlock>();
  const owners = new Map<Element, ReviewBlock>();
  const resized = new Set<Element>();
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
    const resizeTargets = new Set<Element>([root]);
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
      resizeTargets.add(region);
    }
    const elements = new Set(
      root.querySelectorAll<HTMLElement>("[data-review-block]"),
    );
    for (const [element, block] of blocks) {
      if (!elements.has(element)) {
        removeTiles(block);
        blocks.delete(element);
      }
    }
    for (const element of elements) {
      const descendants = Array.from(
        element.querySelectorAll(":not([data-review-tile])"),
      );
      for (const target of [element, ...descendants]) resizeTargets.add(target);
      const overflowing = overflowsHorizontally(element, descendants);
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
        old.overflowing === overflowing &&
        (old.complete || (old.width === width && old.height === height))
      )
        continue;
      if (old) removeTiles(old);
      const block: ReviewBlock = {
        version,
        width,
        height,
        overflowing,
        tiles: [],
        seen: new Set(),
        complete: false,
      };
      blocks.set(element, block);
      // Zero-size content remains an unmet requirement. It never gets a
      // zero-area sentinel, which Chromium could report as fully intersecting.
      // Overflow invalidates even previously completed coverage. Recovery
      // creates fresh targets, so stale observations cannot approve clipping.
      if (overflowing || width <= 0 || height <= 0) continue;
      for (let top = 0; top < height; top += 16) {
        const tile = document.createElement("span");
        tile.dataset["reviewTile"] = "";
        tile.setAttribute("aria-hidden", "true");
        // Overlap the last slice when necessary so every target is >= 1px.
        const tileHeight = Math.max(1, Math.min(16, height - top));
        tile.style.cssText = `position:absolute;pointer-events:none;left:0;top:${Math.max(0, Math.min(top, height - tileHeight))}px;width:${width}px;max-width:100%;height:${tileHeight}px;`;
        element.append(tile);
        block.tiles.push(tile);
        owners.set(tile, block);
        intersection.observe(tile);
      }
    }
    for (const target of resized) {
      if (!resizeTargets.has(target)) {
        resize.unobserve(target);
        resized.delete(target);
      }
    }
    for (const target of resizeTargets) {
      if (!resized.has(target)) {
        resize.observe(target);
        resized.add(target);
      }
    }
    const result = ready();
    changed(result);
    return result;
  }

  window.addEventListener("resize", refresh);
  mutations.observe(root, {
    childList: true,
    characterData: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["data-review-value", "class", "style", "hidden", "open"],
  });
  refresh();
  return {
    refresh,
    dispose() {
      disposed = true;
      window.removeEventListener("resize", refresh);
      mutations.disconnect();
      resize.disconnect();
      intersection.disconnect();
      for (const block of blocks.values()) removeTiles(block);
      blocks.clear();
    },
  };
}
