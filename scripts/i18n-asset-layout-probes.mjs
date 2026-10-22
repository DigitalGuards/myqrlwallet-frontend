import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";

const fixtures = {
  short: { hash: "0xabc123", address: "Q1234" },
  maximal: {
    hash: `0x${"a1b2c3d4".repeat(8)}`,
    address: `Q${"0123456789abcdef".repeat(8)}`,
  },
  "maximal-narrow": {
    hash: `0x${"1".repeat(64)}`,
    address: `Q${"1".repeat(128)}`,
  },
};

// Match the existing display format; the raw fixture still drives copying and navigation.
const fingerprint = (address) =>
  address.length === 129
    ? `${address.slice(0, 9)}...${address.slice(61, 69)}...${address.slice(-8)}`
    : address;
const groupedAddress = (address) =>
  address.length === 129
    ? `Q${address
        .slice(1)
        .match(/.{1,6}/g)
        .join(" ")}`
    : address;

/** Capture every affected element, control and painted text range in document coordinates. */
async function measure(root) {
  return root.evaluate((root) => {
    const elements = [];
    const problems = [];
    const box = (rect) =>
      [rect.x + scrollX, rect.y + scrollY, rect.width, rect.height].map(
        (value) => Math.round(value * 100) / 100,
      );
    const check = (rect, element, name) => {
      if (!rect.width || !rect.height) return;
      if (rect.left < -1 || rect.right > innerWidth + 1)
        problems.push(`${name}: outside viewport`);
      if (
        root.contains(element) &&
        getComputedStyle(element).display === "flex"
      ) {
        const bounds = element.getBoundingClientRect();
        if (rect.left < bounds.left - 1 || rect.right > bounds.right + 1)
          problems.push(`${name}: outside flex row`);
      }
      for (
        let ancestor = element;
        ancestor;
        ancestor = ancestor.parentElement
      ) {
        const style = getComputedStyle(ancestor);
        const bounds = ancestor.getBoundingClientRect();
        if (
          /hidden|clip|auto|scroll/.test(style.overflowX) &&
          (rect.left < bounds.left - 1 || rect.right > bounds.right + 1)
        )
          problems.push(`${name}: clipped horizontally`);
        if (
          root.contains(ancestor) &&
          /hidden|clip/.test(style.overflowY) &&
          (rect.top < bounds.top - 1 || rect.bottom > bounds.bottom + 1)
        )
          problems.push(`${name}: clipped vertically`);
      }
      const button = element.closest("button");
      if (button) {
        const bounds = button.getBoundingClientRect();
        if (
          rect.left < bounds.left - 1 ||
          rect.right > bounds.right + 1 ||
          rect.top < bounds.top - 1 ||
          rect.bottom > bounds.bottom + 1
        )
          problems.push(`${name}: outside button`);
      }
    };
    const visit = (element, name) => {
      const rect = element.getBoundingClientRect();
      elements.push({
        name,
        tag: element.tagName,
        bounds: box(rect),
        text: element.textContent.trim(),
        href: element.getAttribute("href"),
        label: element.getAttribute("aria-label"),
      });
      check(rect, element.parentElement, name);
      if (element.tagName.toLowerCase() === "svg") return;
      let index = 0;
      // The transaction text wrapper is transparent to the base comparison.
      const nodes = [...element.childNodes].flatMap((node) =>
        element.matches('a[href*="/tx/"]') && node.nodeName === "SPAN"
          ? [...node.childNodes]
          : [node],
      );
      for (const node of nodes) {
        if (node.nodeType === Node.ELEMENT_NODE) {
          visit(node, `${name}/${node.tagName.toLowerCase()}${index++}`);
        } else if (
          node.nodeType === Node.TEXT_NODE &&
          node.textContent.trim()
        ) {
          const key = `${name}/text${index++}`;
          const range = document.createRange();
          range.selectNodeContents(node);
          const rects = [...range.getClientRects()];
          elements.push({
            name: key,
            tag: "text",
            text: node.textContent.trim(),
            bounds: box(range.getBoundingClientRect()),
            lines: rects.map(box),
          });
          for (const rect of rects) check(rect, node.parentElement, key);
        }
      }
    };
    visit(root, "root");
    return { elements, problems: [...new Set(problems)] };
  });
}

/** Extra cases run within the existing success screens, retaining the 570-pair matrix. */
export async function assetLayoutProbes({ page, screen, catalogs, output }) {
  if (!["creation-status-success", "nft-import-success"].includes(screen))
    return;
  const baseline = process.env.I18N_BASELINE === "1";
  const token = screen === "creation-status-success";
  const viewport = page.viewportSize();
  const original = await page.evaluate(
    (token) =>
      JSON.parse(
        JSON.stringify(
          token
            ? window.__APP_STORE__.tokenStore.createdToken
            : window.__APP_STORE__.nftStore.nftList,
        ),
      ),
    token,
  );
  const results = [];
  if (!baseline && token)
    await page
      .context()
      .grantPermissions(["clipboard-read", "clipboard-write"]);
  try {
    for (const [size, fixture] of Object.entries(fixtures)) {
      for (const width of [360, 1280]) {
        await page.setViewportSize({ width, height: 800 });
        await page.evaluate(
          ({ token, fixture }) => {
            const store = window.__APP_STORE__;
            if (token) {
              store.tokenStore.createdToken = {
                ...store.tokenStore.createdToken,
                address: fixture.address,
                tx: fixture.hash,
                blockHash: fixture.hash,
              };
            } else {
              store.nftStore.nftList = [
                {
                  contractAddress: fixture.address,
                  tokenId: "42",
                  standard: "ERC1155",
                  balance: "7",
                  fetchedAt: Date.now(),
                },
              ];
            }
            window.scrollTo(0, 0);
          },
          { token, fixture },
        );
        const title = fingerprint(fixture.address);
        const expectedName = `${title} ${catalogs.home.items_one.replace("{{count}}", "1")} · ERC-1155 · ${title}`;
        const root = token
          ? page.locator("[data-page-shell]")
          : page.getByRole("button", { name: expectedName, exact: true });
        await root.waitFor();
        await page.evaluate(() => document.fonts.ready);
        // Wait for React and page-entry animation before comparing subpixel bounds.
        await page.evaluate(async () => {
          await Promise.all(
            document
              .getAnimations()
              .map((animation) =>
                animation.effect.getTiming().iterations === Infinity
                  ? undefined
                  : animation.finished.catch(() => {}),
              ),
          );
        });
        const result = {
          language: catalogs.code,
          screen,
          size,
          width,
          fixture,
          ...(await measure(
            token
              ? root
              : root.locator(
                  'xpath=ancestor::*[contains(@class, "surface-glass")][1]',
                ),
          )),
        };
        if (token) {
          const tx = root.locator(`a[href$="/tx/${fixture.hash}"]`);
          assert.equal(await tx.textContent(), fixture.hash);
          assert.equal(
            await root
              .getByText(groupedAddress(fixture.address), { exact: true })
              .count(),
            1,
          );
          assert.equal(
            await root.getByText(fixture.hash, { exact: true }).count(),
            2,
          );
          result.links = await root
            .locator("a")
            .evaluateAll((links) =>
              links.map((link) => link.getAttribute("href")),
            );
          if (!baseline) {
            const buttons = root.locator("button").filter({
              has: page.locator("svg.lucide-copy,svg.lucide-check"),
            });
            result.copied = [];
            for (const [index, expected] of [
              fixture.hash,
              fixture.address,
              fixture.hash,
            ].entries()) {
              await buttons.nth(index).click();
              const copied = await page.evaluate(() =>
                navigator.clipboard.readText(),
              );
              assert.equal(
                copied,
                expected,
                `${screen}/${size}: exact clipboard value`,
              );
              result.copied.push(copied);
            }
          }
        } else {
          assert.equal(
            await root.count(),
            1,
            "One collection button with the existing accessible name",
          );
          assert.equal(
            await root.locator("button,a,[role=button]").count(),
            0,
            "No nested controls",
          );
          result.accessibleName = expectedName;
        }
        await page.screenshot({
          path: join(output, `${catalogs.code}-${screen}-${size}-${width}.png`),
          fullPage: true,
          animations: "disabled",
        });
        if (!baseline && !token) {
          await root.click();
          await page.waitForURL(
            (url) =>
              url.searchParams.get("collection") ===
              fixture.address.toLowerCase(),
          );
          result.openedCollection = new URL(page.url()).searchParams.get(
            "collection",
          );
          await page.goBack();
          await root.waitFor();
        }
        results.push(result);
        if (!baseline)
          assert.deepEqual(
            result.problems,
            [],
            `${catalogs.code}/${screen}/${size}/${width}: visible values and controls`,
          );
      }
    }
  } finally {
    await writeFile(
      join(output, `${catalogs.code}-${screen}-bounds.json`),
      JSON.stringify(results, null, 2),
    );
    await page.evaluate(
      ({ token, original }) => {
        if (token) window.__APP_STORE__.tokenStore.createdToken = original;
        else window.__APP_STORE__.nftStore.nftList = original;
        window.scrollTo(0, 0);
      },
      { token, original },
    );
    await page.setViewportSize(viewport);
  }
}
