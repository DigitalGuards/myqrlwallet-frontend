/** @jest-environment jsdom */
import { cleanup, render, screen, within } from "@testing-library/react";
import { i18n, applyLanguage } from "@/i18n";
import { languages } from "@/i18n/languages";
import {
  vaultPayload,
  vaultCalldata,
  vaultTestAddress,
  vaultReviewTime,
} from "@/utils/signing/__tests__/quantaVaultFixtures";
import {
  recognizeVaultRequest,
  VAULT_MAX_UINT256,
} from "@/utils/signing/quantaVault";
import { formatQuantaValue } from "@/utils/formatting";
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
  expect(
    screen.getByText(
      /When txGas is zero, a failed inner call reverts the whole transaction and leaves the nonce unused/,
    ),
  ).toBeTruthy();
  expect(screen.queryByText(/txGas is nonzero/)).toBeNull();
});

it.each(["tx", "approval"])(
  "shows effective zero targets and decoded calldata for %s batches",
  (kind) => {
    for (const operation of ["call", "delegatecall"]) {
      const payload = vaultPayload(`${kind}-zero-target-${operation}`);
      const request = recognizeVaultRequest(payload);
      if (!request || request.kind === "VaultMessage")
        throw new Error("Missing vault transaction");
      const executingVault =
        request.kind === "VaultApproval" ? request.outerVault : request.vault;
      const expected = operation === "call" ? request.tx.to : executingVault;
      render(<DAppTypedDataReview payload={payload} />);
      const child = screen.getByText("Enclosed call 1").parentElement;
      if (!child) throw new Error("Missing enclosed call");
      const target = within(child).getByText("To").nextElementSibling;
      expect(
        target?.querySelector("[aria-label]")?.getAttribute("aria-label"),
      ).toContain(expected);
      expect(
        within(child)
          .getByText(/This batch entry named the zero address/)
          .hasAttribute("data-review-block"),
      ).toBe(true);
      expect(within(child).getByText("changeThreshold")).toBeTruthy();
      expect(
        within(child).getByText("Required approvals").nextElementSibling
          ?.textContent,
      ).toBe("2");
      cleanup();
    }
  },
);

it("warns for scheduled updateDelay and unlimited allowances, and leaves a revoked open role unflagged", () => {
  const { rerender } = render(
    <DAppTypedDataReview payload={vaultPayload("scheduled-update-delay")} />,
  );
  expect(screen.getByText("updateDelay")).toBeTruthy();
  expect(screen.getByText("0d 0h 0m 0s (0 seconds)")).toBeTruthy();
  expect(
    screen.getByText(/changes the vault or target contract’s security setup/),
  ).toBeTruthy();
  rerender(<DAppTypedDataReview payload={vaultPayload("unlimited-approve")} />);
  expect(
    screen.getByText(
      /Unlimited allowance: the spender can spend the vault's entire balance of this token/,
    ),
  ).toBeTruthy();
  expect(
    screen.getByText(
      `${VAULT_MAX_UINT256.toString()} base units (token details unavailable)`,
    ),
  ).toBeTruthy();
  rerender(<DAppTypedDataReview payload={vaultPayload("revoke-zero-role")} />);
  expect(screen.getByText("revokeRole")).toBeTruthy();
  expect(screen.queryByText(/opens it to everyone/)).toBeNull();
});

it("renders operation and calldata warnings once without React key collisions", () => {
  const errors = jest
    .spyOn(console, "error")
    .mockImplementation(() => undefined);
  try {
    const payload = vaultPayload("invalid-operation");
    payload.message["data"] = vaultCalldata("approve").data.slice(0, -2);
    const { rerender } = render(<DAppTypedDataReview payload={payload} />);
    expect(
      screen.getAllByText(/Calldata could not be decoded completely/),
    ).toHaveLength(1);
    expect(screen.getAllByText(/This transaction cannot execute/)).toHaveLength(
      1,
    );
    rerender(
      <DAppTypedDataReview payload={vaultPayload("invalid-operation")} />,
    );
    expect(screen.getByText("approve")).toBeTruthy();
    expect(
      screen.queryByText(/Calldata could not be decoded completely/),
    ).toBeNull();
    expect(screen.getByText(/This transaction cannot execute/)).toBeTruthy();
    expect(errors).not.toHaveBeenCalled();
  } finally {
    errors.mockRestore();
  }
});

it.each(["expired-validity", "zero-validity"])(
  "warns that %s will be rejected, allowing for device clock errors",
  (label) => {
    jest.useFakeTimers().setSystemTime(Number(vaultReviewTime) * 1000);
    render(<DAppTypedDataReview payload={vaultPayload(label)} />);
    const warning = screen.getByText(
      /this approval has already expired and the vault will reject it/,
    );
    expect(warning.textContent).toContain("device clock may be incorrect");
    expect(warning.hasAttribute("data-review-block")).toBe(true);
  },
);

it.each([0n, 1n])(
  "keeps validity at now plus %s seconds unexpired",
  (delta) => {
    jest.useFakeTimers().setSystemTime(Number(vaultReviewTime) * 1000);
    const payload = vaultPayload();
    payload.message["validUntil"] = vaultReviewTime + delta;
    render(<DAppTypedDataReview payload={payload} />);
    expect(screen.queryByText(/approval has already expired/)).toBeNull();
  },
);

it("warns that nonzero txGas can consume the nonce on a forced failure", () => {
  render(<DAppTypedDataReview payload={vaultPayload("nonzero-tx-gas")} />);
  expect(
    screen.getByText("txGas (gas check and failure handling)"),
  ).toBeTruthy();
  const warning = screen.getByText(/txGas is nonzero/);
  expect(warning.textContent).toContain(
    "spends the nonce and emits ExecutionFailure",
  );
  expect(warning.textContent).toContain(
    "supply just enough gas to pass GS010 and force that failure",
  );
  expect(warning.hasAttribute("data-review-block")).toBe(true);
});

it.each(["malformed", "0x", "1.5", undefined])(
  "handles connected chain %s and leaves token metadata unavailable",
  (connectedChainId) => {
    const payload = vaultPayload();
    payload.message["to"] = vaultTestAddress;
    payload.message["data"] = vaultCalldata("approve").data;
    render(
      <DAppTypedDataReview
        payload={payload}
        connectedChainId={connectedChainId}
        knownTokens={[
          { address: vaultTestAddress, symbol: "TEST", decimals: 6 },
        ]}
      />,
    );
    expect(
      screen.getByText("1234500 base units (token details unavailable)"),
    ).toBeTruthy();
    expect(screen.queryByText(/differs from the connected chain/)).toBeNull();
  },
);

it.each(["value", "values"])(
  "formats native %s arguments with the shared Quanta formatter",
  (name) => {
    const payload = vaultPayload();
    payload.message["data"] = vaultCalldata(
      name === "value" ? "schedule" : "scheduleBatch",
    ).data;
    const fixture = vaultCalldata(
      name === "value" ? "schedule" : "scheduleBatch",
    );
    const value = fixture.values[1];
    const values = Array.isArray(value) ? value : [value];
    const { container } = render(<DAppTypedDataReview payload={payload} />);
    for (const amount of values) {
      expect(container.textContent).toContain(formatQuantaValue(amount));
    }
  },
);

it("labels a decoded new owner and its full address", () => {
  const payload = vaultPayload();
  payload.message["data"] = vaultCalldata("transferOwnership").data;
  render(<DAppTypedDataReview payload={payload} />);
  expect(
    screen
      .getByText("New owner")
      .nextElementSibling?.querySelector('[data-address-mode="full"]'),
  ).toBeTruthy();
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

it("warns for a local application origin", () => {
  render(
    <DAppTypedDataReview
      payload={vaultPayload()}
      origin="http://localhost:5173"
    />,
  );
  expect(screen.getByText(/This self-reported origin is outside/)).toBeTruthy();
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

it.each(languages)(
  "translates new review warnings and zero-target details in $code",
  async ({ code }) => {
    await applyLanguage(code);
    jest.useFakeTimers().setSystemTime(Number(vaultReviewTime) * 1000);
    for (const [label, key] of [
      ["tx-zero-target-delegatecall", "vaultZeroTarget"],
      ["scheduled-update-delay", "vaultSecurityWarning"],
      ["invalid-operation", "vaultInvalidOperationWarning"],
      ["unlimited-approve", "vaultUnlimitedAllowance"],
      ["expired-validity", "vaultExpiredWarning"],
      ["nonzero-tx-gas", "vaultTxGasWarning"],
    ] as const) {
      render(<DAppTypedDataReview payload={vaultPayload(label)} />);
      const element = screen.getByText(i18n.t(`dapps:${key}`));
      expect(element.hasAttribute("data-review-block")).toBe(true);
      expect(screen.getByText(i18n.t("dapps:vaultTxGas"))).toBeTruthy();
      cleanup();
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
