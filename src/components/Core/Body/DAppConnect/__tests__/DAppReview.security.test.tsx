/** @jest-environment jsdom */

import { cleanup, render, screen } from "@testing-library/react";
import {
  TextDecoder as NodeTextDecoder,
  TextEncoder as NodeTextEncoder,
} from "node:util";

jest.mock("@/utils/signing", () => ({
  hexToBytes: (hex: string): Uint8Array => {
    if (!/^0x(?:[0-9a-fA-F]{2})*$/.test(hex)) throw new Error("invalid hex");
    const bytes = new Uint8Array((hex.length - 2) / 2);
    for (let index = 0; index < bytes.length; index += 1) {
      bytes[index] = Number.parseInt(hex.slice(2 + index * 2, 4 + index * 2), 16);
    }
    return bytes;
  },
}));

import DAppMessageReview from "../DAppMessageReview";
import { tryDecodeUtf8 } from "../messageReview";
import DAppTransactionReview from "../DAppTransactionReview";
import DAppTypedDataReview from "../DAppTypedDataReview";
import { canonicalTypedDataReview } from "../typedDataReview";
import type { TypedDataPayload } from "@/utils/signing";

const originalTextDecoder = Object.getOwnPropertyDescriptor(
  globalThis,
  "TextDecoder",
);
Object.defineProperty(globalThis, "TextDecoder", {
  configurable: true,
  value: NodeTextDecoder,
});

function utf8Hex(value: string): string {
  return `0x${Array.from(new NodeTextEncoder().encode(value), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("")}`;
}

function typedPayload(deepValue: string, saltByte: string): TypedDataPayload {
  return {
    types: {
      QRLDomain: [
        { name: "name", type: "string" },
        { name: "version", type: "string" },
        { name: "salt", type: "bytes32" },
      ],
      Inner: [{ name: "value", type: "string" }],
      Payload: [{ name: "nested", type: "Inner" }],
    },
    primaryType: "Payload",
    domain: {
      name: "Security review",
      version: "1",
      salt: `0x${saltByte.repeat(32)}`,
    },
    message: { nested: { value: deepValue } },
  };
}

afterEach(cleanup);

afterAll(() => {
  if (originalTextDecoder) {
    Object.defineProperty(globalThis, "TextDecoder", originalTextDecoder);
  } else {
    Reflect.deleteProperty(globalThis, "TextDecoder");
  }
});

describe("dApp approval review fidelity", () => {
  it.each([2, 4])('preserves the base elements and classes for a shallow %i-item array', (length) => {
    const payload = typedPayload('unused', '11');
    payload.types['Payload'] = [{ name: 'items', type: 'uint256[]' }];
    payload.message = { items: Array.from({ length }, (_, i) => String(i + 1)) };
    const { container } = render(<DAppTypedDataReview payload={payload} />);
    expect(screen.getByText('items').parentElement?.className).toBe('grid grid-cols-[minmax(0,1fr)_minmax(0,2fr)] gap-2');
    expect(container.querySelector('ul')?.className).toBe('space-y-1 border-l border-border pl-2');
    for (const row of container.querySelectorAll('li')) expect(row.className).toBe('flex gap-2');
    expect(container.querySelector('.review-tree-entry')).toBeNull();
  });

  it('preserves the base shallow record grid and starts stacked full paths at depth 2', () => {
    const payload = typedPayload('1', '11');
    const { container, rerender } = render(<DAppTypedDataReview payload={payload} />);
    const row = screen.getByText('value').parentElement;
    expect(row?.className).toBe('grid grid-cols-[minmax(0,1fr)_minmax(0,2fr)] gap-2');
    expect(row?.parentElement?.className).toBe('mt-1 space-y-1 border-l border-border pl-2');
    expect(container.querySelector('.review-tree-entry')).toBeNull();
    payload.message = { nested: { child: { child: { value: '1' } } } };
    rerender(<DAppTypedDataReview payload={payload} />);
    expect(screen.getByText('nested.child.child.value').parentElement?.className).toBe('review-tree-entry');
    expect(screen.getAllByText('child').every((label) => label.parentElement?.className.startsWith('grid '))).toBe(true);
  });

  it.each(["1", "0x1", 1, 1n])("warns when signed chain %s differs from the wallet chain", (chainId) => {
    const payload = typedPayload("chain warning", "11");
    payload.types["QRLDomain"] = [
      ...(payload.types["QRLDomain"] ?? []),
      { name: "chainId", type: "uint256" },
    ];
    payload.domain["chainId"] = chainId;
    render(<DAppTypedDataReview payload={payload} connectedChainId="0x301825" />);
    expect(screen.getByRole("alert").textContent).toContain("chain ID (1) differs from the connected chain (3151909)");
  });

  it.each(["3151909", "0x301825", 3151909, 3151909n])("accepts equivalent chain encodings: %s", (chainId) => {
    const payload = typedPayload("same chain", "11");
    payload.types["QRLDomain"] = [
      ...(payload.types["QRLDomain"] ?? []),
      { name: "chainId", type: "uint256" },
    ];
    payload.domain["chainId"] = chainId;
    render(<DAppTypedDataReview payload={payload} connectedChainId="0x301825" />);
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByText(/signature is not bound to a chain/)).toBeNull();
  });

  it("explains when a signature has no chain binding", () => {
    render(<DAppTypedDataReview payload={typedPayload("no chain", "11")} connectedChainId="0x301825" />);
    expect(screen.getByText(/This domain has no chain ID. The signature is not bound to a chain./)).toBeTruthy();
  });

  it("shows the exact transaction signing account", () => {
    const from = `Q${"ABCDEF".repeat(21)}AB`;
    const { container } = render(
      <DAppTransactionReview
        params={{
          from,
          to: `Q${"1".repeat(128)}`,
          value: "0x0",
        }}
      />,
    );

    expect(container.textContent).toContain("From");
    expect(container.textContent).toContain(from);
  });

  it("distinguishes deep message values and signed domain salt in review text", () => {
    const first = typedPayload("deep-alpha", "11");
    const second = typedPayload("deep-beta", "22");
    const firstView = render(<DAppTypedDataReview payload={first} />);
    const firstText = firstView.container.textContent;
    firstView.unmount();
    const secondView = render(<DAppTypedDataReview payload={second} />);
    const secondText = secondView.container.textContent;

    expect(firstText).toContain("deep-alpha");
    expect(firstText).toContain(`0x${"11".repeat(32)}`);
    expect(firstText).toContain("version");
    expect(firstText).toContain("salt");
    expect(secondText).toContain("deep-beta");
    expect(secondText).toContain(`0x${"22".repeat(32)}`);
    expect(secondText).not.toBe(firstText);
    expect(canonicalTypedDataReview(first)).not.toBe(
      canonicalTypedDataReview(second),
    );
  });

  it.each([
    "safe\u202Espoof",
    "zero\u200bwidth",
    "bom\ufeffinside",
    "line\u2028separator",
    "paragraph\u2029separator",
  ])(
    "falls back to raw hex for unsafe format controls in %s",
    (message) => {
      const messageHex = utf8Hex(message);
      expect(tryDecodeUtf8(messageHex)).toEqual({
        ok: false,
        reason: "format-controls",
      });
      const { container } = render(
        <DAppMessageReview messageHex={messageHex} />,
      );

      expect(container.textContent).toContain(
        "Not a safely printable UTF-8 string",
      );
      expect(container.textContent).toContain(messageHex);
      expect(container.querySelector('[dir="ltr"]')).not.toBeNull();
    },
  );

  it("falls back to raw hex for C1 controls", () => {
    const messageHex = utf8Hex("safe\u0085spoof");
    expect(tryDecodeUtf8(messageHex)).toEqual({
      ok: false,
      reason: "control-chars",
    });
    const { container } = render(<DAppMessageReview messageHex={messageHex} />);
    expect(container.textContent).toContain(messageHex);
  });

  it("discloses raw signed bytes even for printable UTF-8", () => {
    const messageHex = utf8Hex("approve exactly this text");
    const { container } = render(
      <DAppMessageReview messageHex={messageHex} />,
    );

    expect(container.textContent).toContain("approve exactly this text");
    expect(container.textContent).toContain("Raw signed bytes");
    expect(container.textContent).toContain(messageHex);
  });

  it.each([
    " ", "\t", "\n", " \t ", "\u200b\u202e", "\ufeff", "\u00ad\u034f\u2060", "\u3164\ufe0f",
  ])("shows invisible-only messages as required raw bytes: %j", (message) => {
    const messageHex = utf8Hex(message);
    expect(tryDecodeUtf8(messageHex)).toEqual({ ok: false, reason: "invisible-chars" });
    const { container } = render(<DAppMessageReview messageHex={messageHex} />);
    const raw = screen.getByText(messageHex);
    expect(raw.hasAttribute("data-review-block")).toBe(true);
    expect(raw.closest("details")).toBeNull();
    expect(container.textContent).toContain("Raw signed bytes (hex):");
    expect(raw.textContent).toBe(messageHex);
  });

  it("gives an empty message an observable primary representation", () => {
    render(<DAppMessageReview messageHex="0x" />);
    expect(screen.getByText("Empty message (0 bytes).").hasAttribute("data-review-block")).toBe(true);
  });

  it("preserves a 2,000-character unbroken printable message", () => {
    const message = "x".repeat(2000);
    render(<DAppMessageReview messageHex={utf8Hex(message)} />);
    expect(screen.getByText(message).hasAttribute("data-review-block")).toBe(true);
  });

  it("distinguishes a five-level nested to from the top-level to using full paths", () => {
    const payload: TypedDataPayload = {
      types: {
        QRLDomain: [{ name: "name", type: "string" }],
        Review: [{ name: "to", type: "string" }, { name: "order", type: "Order" }],
        Order: [{ name: "fulfillment", type: "Fulfillment" }],
        Fulfillment: [{ name: "items", type: "Item[]" }],
        Item: [{ name: "recipient", type: "Recipient" }],
        Recipient: [{ name: "to", type: "string" }],
      },
      primaryType: "Review",
      domain: { name: "Example" },
      message: {
        to: "top-level-recipient",
        order: {
          fulfillment: {
            items: Array.from({ length: 4 }, (_, i) => ({
              recipient: { to: `nested-recipient-${i}` },
            })),
          },
        },
      },
    };
    render(<DAppTypedDataReview payload={payload} />);

    expect(screen.getByText("to", { exact: true }).parentElement?.textContent)
      .toBe('to"top-level-recipient"');
    for (const label of ["order", "fulfillment", "items"])
      expect(screen.getByText(label, { exact: true })).toBeTruthy();
    for (let i = 0; i < 4; i++) {
      const itemPath = `order.fulfillment.items[${i}]`;
      expect(screen.getByText(itemPath, { exact: true })).toBeTruthy();
      expect(screen.getByText(`${itemPath}.recipient`, { exact: true })).toBeTruthy();
      const path = `${itemPath}.recipient.to`;
      const label = screen.getByText(path, { exact: true });
      expect(label.parentElement?.textContent).toBe(`${path}"nested-recipient-${i}"`);
      expect(label.closest("[data-review-block]")).not.toBeNull();
      expect(label.closest("details")).toBeNull();
      expect(screen.queryByText(`[${i}]`, { exact: true })).toBeNull();
    }
  });

  it("keeps shallow array indices and labels deeper array dimensions with their full paths", () => {
    const payload: TypedDataPayload = {
      types: {
        QRLDomain: [{ name: "name", type: "string" }],
        Review: [{ name: "amounts", type: "uint256[][][][]" }],
      },
      primaryType: "Review",
      domain: { name: "Example" },
      message: { amounts: [[[["17"]]]] },
    };
    render(<DAppTypedDataReview payload={payload} />);
    expect(screen.getByText("amounts", { exact: true })).toBeTruthy();
    expect(screen.getAllByText("[0]", { exact: true })).toHaveLength(2);
    expect(screen.getByText("amounts[0][0][0]", { exact: true })).toBeTruthy();
    const label = screen.getByText("amounts[0][0][0][0]", { exact: true });
    expect(label.parentElement?.textContent).toBe('amounts[0][0][0][0]"17"');
  });

  it.each(["SENSITIVE", "x".repeat(2000)])("keeps a ten-level leaf in the primary review (fixture %#)", (leaf) => {
    const payload = typedPayload(leaf, "11");
    payload.types = { QRLDomain: [{ name: "name", type: "string" }] };
    for (let i = 0; i < 10; i++) {
      payload.types[`Nested${i}`] = [{ name: "value", type: i === 9 ? "string" : `Nested${i + 1}` }];
    }
    payload.primaryType = "Nested0";
    payload.domain = { name: "Example" };
    let message: Record<string, unknown> = { value: leaf };
    for (let i = 1; i < 10; i++) message = { value: message };
    payload.message = message;
    render(<DAppTypedDataReview payload={payload} />);
    const displayed = screen.getByText(JSON.stringify(leaf), { selector: "span" });
    expect(displayed.closest("[data-review-block]")).not.toBeNull();
    expect(displayed.closest("details")).toBeNull();
    const path = "value.value.value.value.value.value.value.value.value.value";
    expect(screen.getByText(path, { exact: true }).parentElement?.textContent)
      .toBe(`${path}${JSON.stringify(leaf)}`);
    let indents = 0;
    for (let parent = displayed.parentElement; parent; parent = parent.parentElement) {
      if (parent.classList.contains("pl-2")) indents++;
    }
    expect(indents).toBe(2);
  });
});
