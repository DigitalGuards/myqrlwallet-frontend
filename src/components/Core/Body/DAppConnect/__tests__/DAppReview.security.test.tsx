/** @jest-environment jsdom */

import { cleanup, render } from "@testing-library/react";
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

import DAppMessageReview, {
  tryDecodeUtf8,
} from "../DAppMessageReview";
import DAppTransactionReview from "../DAppTransactionReview";
import DAppTypedDataReview, {
  canonicalTypedDataReview,
} from "../DAppTypedDataReview";
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
  it("shows the exact transaction signing account", () => {
    const from = "QABCDEFABCDEFABCDEFABCDEFABCDEFABCDEFABCD";
    const { container } = render(
      <DAppTransactionReview
        params={{
          from,
          to: "Q1111111111111111111111111111111111111111",
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
    const firstText = firstView.container.textContent ?? "";
    firstView.unmount();
    const secondView = render(<DAppTypedDataReview payload={second} />);
    const secondText = secondView.container.textContent ?? "";

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
});
