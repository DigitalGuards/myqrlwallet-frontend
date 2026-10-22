import assert from "node:assert/strict";

// English, 360x800, bundled fonts, Example dApp / https://dapp.example.
// Measured on origin/dev 6b1e544c21d278a0aa8a8614828cc563b91f130f.
export const minimumIdentityWidths = {
  qrl_requestAccounts: 74,
  qrl_sendTransaction: 76,
  qrl_signTransaction: 80,
  qrl_signMessage: 97,
  qrl_signTypedData: 84,
  wallet_addQrlChain: 100,
  wallet_switchQrlChain: 85,
};

/** Measure the rendered identity even when it has collapsed to zero width. */
export async function assertApprovalIdentity(
  page,
  {
    language,
    method,
    metadata = { name: "Example dApp", url: "https://dapp.example" },
  },
) {
  await page.evaluate(() => document.fonts.ready);
  const header = await page.getByRole("dialog").evaluate((dialog) => {
    const title = dialog.querySelector("h2");
    const identity = title?.parentElement;
    const origin = identity?.querySelector("p");
    const label = identity?.nextElementSibling;
    if (!title || !identity || !origin || !label)
      throw new Error("Approval identity header is missing");
    const measure = (element) => {
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      let visible = element.checkVisibility({
        checkOpacity: true,
        checkVisibilityCSS: true,
      });
      // Include clipping ancestors and occlusion, including after details scroll.
      for (
        let parent = element.parentElement;
        parent;
        parent = parent.parentElement
      ) {
        const bounds = parent.getBoundingClientRect();
        const parentStyle = getComputedStyle(parent);
        if (parentStyle.overflowX !== "visible")
          visible &&=
            rect.left >= bounds.left - 1 && rect.right <= bounds.right + 1;
        if (parentStyle.overflowY !== "visible")
          visible &&=
            rect.top >= bounds.top - 1 && rect.bottom <= bounds.bottom + 1;
      }
      const atCenter = document.elementFromPoint(
        rect.left + rect.width / 2,
        rect.top + rect.height / 2,
      );
      return {
        top: rect.top,
        bottom: rect.bottom,
        width: rect.width,
        height: rect.height,
        fontSize: parseFloat(style.fontSize),
        text: element.textContent,
        visible: visible && element.contains(atCenter),
        inViewport:
          rect.left >= 0 &&
          rect.right <= innerWidth &&
          rect.top >= 0 &&
          rect.bottom <= innerHeight,
        clipped: element.scrollWidth > element.clientWidth + 1,
      };
    };
    return {
      identity: measure(identity),
      name: measure(title),
      origin: measure(origin),
      label: measure(label),
    };
  });
  const minimum = minimumIdentityWidths[method];
  assert.ok(minimum, `Missing English identity baseline for ${method}`);
  for (const part of ["identity", "name", "origin"]) {
    const box = header[part];
    assert.ok(
      box.width >= minimum && box.height > 0 && box.visible && box.inViewport,
      `${language}/${method}: ${part} must remain visible and at least ${minimum}px wide: ${JSON.stringify(box)}`,
    );
  }
  assert.equal(header.name.text, metadata.name);
  assert.equal(header.origin.text, metadata.url);
  assert.ok(
    header.name.fontSize >= 16 && header.origin.fontSize >= 12,
    `${language}/${method}: identity text is smaller than the English baseline`,
  );
  assert.ok(
    !header.label.clipped &&
      header.label.visible &&
      header.label.inViewport &&
      header.label.top >= header.identity.bottom,
    `${language}/${method}: request title must wrap within the header`,
  );
  return {
    language,
    method,
    minimum,
    ...Object.fromEntries(
      Object.entries(header).map(([key, box]) => [
        key,
        { ...box, text: box.text.slice(0, 80), textLength: box.text.length },
      ]),
    ),
  };
}
