/**
 * @jest-environment jsdom
 *
 * Which clipboard copies are marked sensitive. The app uses the flag to set
 * Android's sensitive-content flag and to clear the entry after a minute, so
 * flagging an address would make it vanish while the user was pasting it, and
 * failing to flag a seed would leave the wallet in clipboard history.
 */
import { readFileSync } from "fs";
import { join } from "path";
import { beforeEach, describe, expect, it, jest } from "@jest/globals";

// The native bridge exists only in the embedded build, which the app ships.
jest.mock("@/utils/embeddedRuntime", () => ({
  ...jest.requireActual<typeof import("@/utils/embeddedRuntime")>(
    "@/utils/embeddedRuntime",
  ),
  IS_EMBEDDED_BUILD: true,
}));

const repoRoot = join(__dirname, "..", "..", "..");
const postMessage = jest.fn((_message: string) => undefined);

beforeEach(() => {
  jest.clearAllMocks();
  Object.defineProperty(window, "ReactNativeWebView", {
    configurable: true,
    value: { postMessage },
  });
  Object.defineProperty(window.navigator, "userAgent", {
    configurable: true,
    value: "Mozilla/5.0 MyQRLWallet/1.4.2",
  });
});

describe("the sensitive flag reaches the app", () => {
  it("is false by default", async () => {
    const { copyToClipboard } = await import("@/utils/nativeApp");
    await copyToClipboard("Q0123");

    const payload = JSON.parse(postMessage.mock.calls[0]?.[0] ?? "{}");
    expect(payload.type).toBe("COPY_TO_CLIPBOARD");
    expect(payload.payload.sensitive).toBe(false);
  });

  it("is set when the caller asks for it", async () => {
    const { copyToClipboard } = await import("@/utils/nativeApp");
    await copyToClipboard("word ".repeat(12).trim(), true);

    const payload = JSON.parse(postMessage.mock.calls[0]?.[0] ?? "{}");
    expect(payload.payload.sensitive).toBe(true);
  });
});

describe("which call sites mark their copy sensitive", () => {
  const read = (relative: string) =>
    readFileSync(join(repoRoot, relative), "utf8");

  it("marks the recovery phrase and the hex seed", () => {
    const mnemonic = read(
      "src/components/Core/Body/CreateAccount/MnemonicDisplay/MnemonicDisplay.tsx",
    );
    expect(mnemonic).toMatch(/copyToClipboard\(mnemonic,\s*true\)/);
    expect(mnemonic).toMatch(/copyToClipboard\(accountHexSeed,\s*true\)/);
  });

  it("leaves public values unflagged, so they survive long enough to paste", () => {
    // An address, a token address and a transaction hash are public, and
    // clearing them after a minute would be a bug rather than a protection.
    for (const [file, call] of [
      [
        "src/components/Core/Body/CreateAccount/MnemonicDisplay/MnemonicDisplay.tsx",
        "copyToClipboard(accountAddress)",
      ],
      [
        "src/components/Core/Body/AccountList/CopyAddressButton/CopyAddressButton.tsx",
        "copyToClipboard(accountAddress)",
      ],
      [
        "src/components/Core/Body/ImportAccount/AccountImportSuccess/AccountImportSuccess.tsx",
        "copyToClipboard(accountAddress)",
      ],
    ] as const) {
      expect(read(file)).toContain(call);
    }
  });

  it("has no secret copy left unflagged", () => {
    // A new seed or phrase copy must opt in deliberately.
    const mnemonic = read(
      "src/components/Core/Body/CreateAccount/MnemonicDisplay/MnemonicDisplay.tsx",
    );
    const unflagged = [
      ...mnemonic.matchAll(/copyToClipboard\(([A-Za-z0-9_]+)\)/g),
    ].map((match) => match[1]);
    expect(unflagged).toEqual(["accountAddress"]);
  });
});
