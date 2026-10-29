/** @jest-environment jsdom */
import { cleanup, render, screen } from "@testing-library/react";
import { i18n, applyLanguage } from "@/i18n";
import { languages } from "@/i18n/languages";
import {
  vaultPayload,
  vaultCalldata,
  vaultTestAddress,
} from "@/utils/signing/__tests__/quantaVaultFixtures";
import { VAULT_MAX_UINT256 } from "@/utils/signing/quantaVault";
import DAppTypedDataReview from "../DAppTypedDataReview";

afterEach(async () => {
  cleanup();
  jest.useRealTimers();
  await applyLanguage("en");
});

it("shows the signed vault, destination, exact Quanta amount, chain and full payload", () => {
  const payload = vaultPayload();
  payload.message["value"] = "1000000000000000001";
  const { container } = render(
    <DAppTypedDataReview
      payload={payload}
      connectedChainId="0x1"
      origin="https://quantavault.io"
      digestHex="0x1234"
    />,
  );
  expect(screen.getByText("Approve a vault transaction")).toBeTruthy();
  expect(screen.getByText("1.000000000000000001 Quanta")).toBeTruthy();
  expect(screen.getByText("Call")).toBeTruthy();
  expect(
    screen.getByText("Network (chain ID)").nextElementSibling?.textContent,
  ).toBe("1");
  expect(container.querySelectorAll('[data-address-mode="full"]').length).toBe(
    4,
  );
  expect(
    screen.getByText("Full signed payload (canonical JSON)").parentElement
      ?.textContent,
  ).toContain('"verifyingContract"');
  expect(screen.getByText("0x1234")).toBeTruthy();
  expect(screen.getByText(/txGas is information only/)).toBeTruthy();
});

it("identifies both vaults and renders the nested VaultTx", () => {
  const payload = vaultPayload("approval-fields");
  render(
    <DAppTypedDataReview payload={payload} origin="https://quantavault.io" />,
  );
  expect(screen.getByText("Approve another vault’s transaction")).toBeTruthy();
  expect(screen.getByText("On behalf of outer vault")).toBeTruthy();
  expect(screen.getByText("Nonce")).toBeTruthy();
  expect(screen.getByText("Refund receiver")).toBeTruthy();
  expect(screen.getByText("DelegateCall")).toBeTruthy();
});

it.each([63, 64, 65])(
  "warns for exactly 64 message bytes (length=%s)",
  (length) => {
    const payload = vaultPayload("empty-message");
    payload.message["message"] = `0x${"ab".repeat(length)}`;
    render(
      <DAppTypedDataReview payload={payload} origin="https://quantavault.io" />,
    );
    expect(
      screen.queryByText(
        /Vault-to-vault approvals should use VaultApproval/,
      ) !== null,
    ).toBe(length === 64);
    expect(
      screen
        .getByText(`0x${"ab".repeat(length)}`)
        .hasAttribute("data-review-block"),
    ).toBe(true);
  },
);

it("falls back to generic fields with a prominent warning for a near-match", () => {
  const payload = vaultPayload();
  payload.domain["version"] = "2";
  render(
    <DAppTypedDataReview payload={payload} origin="https://quantavault.io" />,
  );
  expect(screen.getByRole("alert").textContent).toContain(
    "does not match its exact signing schema",
  );
  expect(screen.getByText("Signed domain")).toBeTruthy();
  expect(screen.getByText("txGas")).toBeTruthy();
  expect(screen.queryByText("Approve a vault transaction")).toBeNull();
});

it("warns for a self-reported origin and a mismatched signed chain", () => {
  render(
    <DAppTypedDataReview
      payload={vaultPayload()}
      connectedChainId="0x2"
      origin="https://self-hosted.example/vault"
    />,
  );
  expect(screen.getByText(/This self-reported origin is outside/)).toBeTruthy();
  expect(screen.getByText(/wallet cannot authenticate it/)).toBeTruthy();
  expect(
    screen.getByText(/differs from the connected chain \(2\)/),
  ).toBeTruthy();
});

it("formats local expiry dates and warns after 30 days and at the maximum", () => {
  jest.useFakeTimers().setSystemTime(new Date("2026-10-29T12:00:00Z"));
  const now = BigInt(Math.floor(Date.now() / 1000));
  const payload = vaultPayload();
  payload.message["validUntil"] = now + 30n * 86400n;
  const { rerender } = render(
    <DAppTypedDataReview payload={payload} origin="https://quantavault.io" />,
  );
  expect(screen.queryByText(/valid for more than 30 days/)).toBeNull();
  expect(
    screen.getByText(
      `${new Date(Number(now + 30n * 86400n) * 1000).toLocaleString("en")} (local time)`,
    ),
  ).toBeTruthy();
  payload.message["validUntil"] = now + 30n * 86400n + 1n;
  rerender(
    <DAppTypedDataReview payload={payload} origin="https://quantavault.io" />,
  );
  expect(screen.getByText(/valid for more than 30 days/)).toBeTruthy();
  payload.message["validUntil"] = VAULT_MAX_UINT256;
  rerender(
    <DAppTypedDataReview payload={payload} origin="https://quantavault.io" />,
  );
  expect(screen.getByText(/approval has no practical expiry/)).toBeTruthy();
  expect(screen.getByText(/Beyond the supported date range/)).toBeTruthy();
});

it.each(["transfer", "transferFrom", "approve"])(
  "formats known token %s amounts only on the signed chain",
  (method) => {
    const payload = vaultPayload();
    payload.message["to"] = vaultTestAddress;
    payload.message["data"] = vaultCalldata(method).data;
    const tokens = [{ address: vaultTestAddress, symbol: "TEST", decimals: 6 }];
    const { rerender } = render(
      <DAppTypedDataReview
        payload={payload}
        connectedChainId="0x1"
        knownTokens={tokens}
      />,
    );
    expect(screen.getByText("1.2345 TEST")).toBeTruthy();
    rerender(
      <DAppTypedDataReview
        payload={payload}
        connectedChainId="0x2"
        knownTokens={tokens}
      />,
    );
    expect(
      screen.getByText("1234500 base units (token details unavailable)"),
    ).toBeTruthy();
    expect(screen.queryByText("1.2345 TEST")).toBeNull();
  },
);

it("shows each batch entry and retains the DelegateCall warning", () => {
  const payload = vaultPayload();
  payload.message["operation"] = 1;
  payload.message["data"] = vaultCalldata("multiSend").data;
  render(<DAppTypedDataReview payload={payload} />);
  expect(screen.getByText("Enclosed call 1")).toBeTruthy();
  expect(screen.getByText("Enclosed call 2")).toBeTruthy();
  expect(screen.getByText("transferOwnership")).toBeTruthy();
  expect(screen.getAllByText(/full control of the vault/)).toHaveLength(2);
  expect(screen.getByText(/Unknown selector/)).toBeTruthy();
  expect(screen.getByText("2.000000000000000001 Quanta")).toBeTruthy();
});

it.each(languages)(
  "renders critical security text in $code with review visibility markers",
  async ({ code }) => {
    await applyLanguage(code);
    const payload = vaultPayload();
    payload.message["operation"] = 1;
    payload.message["baseGas"] = 1;
    payload.message["data"] = vaultCalldata("signMessage").data;
    render(<DAppTypedDataReview payload={payload} connectedChainId="0x2" />);
    for (const key of [
      "vaultRefundError",
      "vaultDelegateWarning",
      "vaultOpaqueWarning",
      "vaultOriginWarning",
      "vaultGasInfo",
    ] as const) {
      const element = screen.getByText(i18n.t(`dapps:${key}`));
      expect(element.hasAttribute("data-review-block")).toBe(true);
    }
  },
);

it("formats timelock delays and decodes the scheduled call", () => {
  const payload = vaultPayload();
  payload.message["data"] = vaultCalldata("schedule").data;
  render(<DAppTypedDataReview payload={payload} />);
  expect(screen.getByText("2d 0h 0m 1s (172801 seconds)")).toBeTruthy();
  expect(screen.getByText("transferOwnership")).toBeTruthy();
});
