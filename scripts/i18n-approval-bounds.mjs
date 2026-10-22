import assert from "node:assert/strict";
import { assertApprovalIdentity } from "./i18n-approval-identity.mjs";

// origin/dev 6b1e544c21d278a0aa8a8614828cc563b91f130f, English, 360x800.
// Same seven requests as slice4Screens, bundled fonts and successful fee RPC.
// All three accepted metadata fixtures produce these same detail heights.
const minimumDetailsHeights = {
  qrl_requestAccounts: 88,
  qrl_sendTransaction: 573,
  qrl_signTransaction: 573,
  qrl_signMessage: 264,
  qrl_signTypedData: 573,
  wallet_addQrlChain: 48,
  wallet_switchQrlChain: 48,
};

const settleScroll = (page) =>
  page.evaluate(
    () =>
      new Promise((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(resolve));
      }),
  );

/** Check actual painted text, including ancestor clipping and focus/scroll effects. */
export async function assertApprovalBounds(
  page,
  { language, method, metadata, approve },
) {
  const context = `${language}/${method}`;
  const identity = await assertApprovalIdentity(page, {
    language,
    method,
    metadata,
  });
  const dialog = page.getByRole("dialog");
  const details = dialog.getByRole("region");
  const measure = () =>
    dialog.evaluate((dialog, approve) => {
      const details = dialog.querySelector('[role="region"]');
      const title = dialog.querySelector("h2");
      const url = title.parentElement.querySelector("p");
      const header = details.previousElementSibling;
      const button = [...dialog.querySelectorAll("button")].find(
        (button) => button.textContent === approve,
      );
      const bounds = details.getBoundingClientRect();
      const visible = (element, rect = element.getBoundingClientRect()) => {
        if (
          !element.checkVisibility({
            checkVisibilityCSS: true,
            checkOpacity: true,
          })
        )
          return false;
        if (
          rect.width <= 0 ||
          rect.height <= 0 ||
          rect.top < 0 ||
          rect.bottom > innerHeight ||
          rect.left < 0 ||
          rect.right > innerWidth
        )
          return false;
        for (let parent = element; parent; parent = parent.parentElement) {
          const box = parent.getBoundingClientRect();
          const style = getComputedStyle(parent);
          if (
            style.overflowY !== "visible" &&
            (rect.top < box.top - 1 || rect.bottom > box.bottom + 1)
          )
            return false;
          if (
            style.overflowX !== "visible" &&
            (rect.left < box.left - 1 || rect.right > box.right + 1)
          )
            return false;
        }
        const hit = document.elementFromPoint(
          rect.x + rect.width / 2,
          rect.y + rect.height / 2,
        );
        // Disabled Approve still paints even though pointer-events skips it.
        return (
          element.contains(hit) ||
          (getComputedStyle(element).pointerEvents === "none" &&
            hit === element.parentElement)
        );
      };
      const characterVisible = (element, last = false) => {
        if (!element) return null;
        const nodes = [];
        const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
        for (let node = walker.nextNode(); node; node = walker.nextNode()) {
          if (node.textContent.trim()) nodes.push(node);
        }
        const node = last ? nodes.at(-1) : nodes[0];
        if (!node) return null;
        const range = document.createRange();
        const offset = last ? node.length - 1 : node.textContent.search(/\S/);
        range.setStart(node, offset);
        range.setEnd(node, offset + 1);
        return visible(node.parentElement, range.getBoundingClientRect());
      };
      const signed = [...details.querySelectorAll('[dir="ltr"]')].filter(
        (element) => !element.closest("details:not([open])"),
      );
      const urlStyle = getComputedStyle(url);
      const range = document.createRange();
      range.selectNodeContents(url);
      const selection = getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      const fullUrlSelectable = selection.toString() === url.textContent;
      selection.removeAllRanges();
      // The origin prefix stays at the left edge; the full URL remains selectable
      // and in the accessibility tree, as it does on origin/dev.
      range.setStart(url.firstChild, 0);
      range.setEnd(url.firstChild, new URL(url.textContent).origin.length);
      return {
        headerHeight: header.getBoundingClientRect().height,
        detailsHeight: bounds.height,
        detailsVisible: visible(details),
        scrollTop: details.scrollTop,
        scrollHeight: details.scrollHeight,
        signedStartVisible: characterVisible(signed[0]),
        signedEndVisible: characterVisible(signed.at(-1), true),
        approveVisible: visible(button),
        url: {
          height: url.getBoundingClientRect().height,
          whiteSpace: urlStyle.whiteSpace,
          overflow: urlStyle.overflowX,
          textOverflow: urlStyle.textOverflow,
          direction: urlStyle.direction,
          originVisible: visible(url, range.getBoundingClientRect()),
          fullUrlSelectable,
          truncated: url.scrollWidth > url.clientWidth,
        },
      };
    }, approve);
  const measurements = [];
  const check = async (phase) => {
    await settleScroll(page);
    await assertApprovalIdentity(page, { language, method, metadata });
    const result = await measure();
    measurements.push({ phase, ...result });
    assert.ok(result.headerHeight <= 128, `${context}: header is unbounded`);
    assert.ok(
      result.detailsHeight >= minimumDetailsHeights[method],
      `${context}: ${result.detailsHeight}px details below ${minimumDetailsHeights[method]}px English baseline`,
    );
    assert.ok(result.detailsVisible, `${context}: details clipped`);
    assert.ok(
      result.url.height <= 16 &&
        result.url.whiteSpace === "nowrap" &&
        result.url.overflow === "hidden" &&
        result.url.textOverflow === "ellipsis" &&
        result.url.direction === "ltr",
      `${context}: URL must truncate on one line`,
    );
    assert.ok(
      result.url.originVisible &&
        result.url.fullUrlSelectable &&
        result.url.truncated,
      `${context}: URL origin or full value is inaccessible`,
    );
    assert.ok(
      !result.approveVisible ||
        (result.scrollTop === 0 && result.signedStartVisible !== false),
      `${context}/${phase}: Approve visible without the signed content's start`,
    );
    return result;
  };
  const initial = await check("initial");
  if (method.startsWith("qrl_sign") || method === "qrl_sendTransaction") {
    assert.equal(
      initial.signedStartVisible,
      true,
      `${context}: signed content is missing or hidden`,
    );
  }
  assert.equal(
    initial.scrollTop,
    0,
    `${context}: autofocus scrolled past the review start`,
  );
  assert.ok(
    initial.approveVisible && initial.signedStartVisible !== false,
    `${context}: initial review or approval is hidden`,
  );
  await details.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });
  await check("bottom");
  // Every signed value must be reachable, including the final character.
  await details.evaluate((element) => {
    const signed = [...element.querySelectorAll('[dir="ltr"]')].filter(
      (node) => !node.closest("details:not([open])"),
    );
    const last = signed.at(-1);
    if (last) {
      last.scrollIntoView({ block: "nearest" });
      last.scrollTop = last.scrollHeight;
    }
  });
  const end = await check("signed-end");
  assert.notEqual(
    end.signedEndVisible,
    false,
    `${context}: signed content is clipped and unreachable`,
  );
  await details.evaluate((element) => {
    for (const node of [element, ...element.querySelectorAll("*")]) {
      node.scrollTop = 0;
      node.scrollLeft = 0;
    }
  });
  const returned = await check("returned-to-start");
  assert.ok(
    returned.approveVisible && returned.signedStartVisible !== false,
    `${context}: approval did not return with the review start`,
  );
  return {
    language,
    method,
    identityWidth: identity.identity.width,
    minimumDetailsHeight: minimumDetailsHeights[method],
    measurements,
  };
}
