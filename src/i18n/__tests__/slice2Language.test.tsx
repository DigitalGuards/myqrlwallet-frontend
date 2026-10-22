/** @jest-environment jsdom */
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { HelmetProvider } from "react-helmet-async";
import { useTranslation } from "react-i18next";
import { applyLanguage, i18n } from "../index";
import { transferMessage } from "../transferMessage";
import { transferError } from "../transferError";
import AddressBook from "@/components/Core/Body/AddressBook/AddressBook";
import { SendStatus } from "@/components/Core/Body/Transfer/SendStatus";
import { GasFeeNotice } from "@/components/Core/Body/Transfer/GasFeeNotice/GasFeeNotice";

const mockEstimate = jest.fn(() => Promise.resolve(21000n));
const mockProvider = { estimateGas: mockEstimate };
jest.mock("@/stores/store", () => ({
  useStore: () => ({ qrlStore: { qrlInstance: mockProvider } }),
}));
jest.mock("@/stores/qrlStore", () => ({
  quoteFees: () =>
    Promise.resolve({
      expectedFeePerGas: 3n,
      maxFeePerGas: 5n,
      maxPriorityFeePerGas: 1n,
    }),
}));
jest.mock("@/config/runtimeProfile", () => ({
  profileStorageKey: (key: string) => key,
}));
jest.mock("@/config", () => ({
  getExplorerTxUrl: () => "https://explorer.example/tx",
}));
jest.mock("@/utils", () =>
  jest.requireActual<typeof import("@/utils/cn")>("@/utils/cn"),
);
jest.mock("react-router", () => ({ useNavigate: () => jest.fn() }));
jest.mock("@/router/router", () => ({
  ROUTES: { ADDRESS_BOOK: "/address-book", TRANSFER: "/transfer" },
}));
jest.mock("@/utils/nativeApp", () => ({
  isInNativeApp: () => false,
  copyToClipboard: () => Promise.resolve(true),
}));

beforeEach(async () => {
  localStorage.clear();
  jest.clearAllMocks();
  await applyLanguage("en");
});
afterEach(() => {
  cleanup();
  jest.useRealTimers();
});

it("updates a visible contact validation error without closing the dialog or changing its input", async () => {
  render(
    <HelmetProvider>
      <AddressBook />
    </HelmetProvider>,
  );
  fireEvent.click(screen.getByRole("button", { name: "Add" }));
  fireEvent.change(screen.getByLabelText("Name"), {
    target: { value: "Savings" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  expect(
    screen.getByText("Not a valid QRL address (Q + 128 hex characters)"),
  ).toBeTruthy();
  await act(() => applyLanguage("de"));
  expect(
    screen.getByText("Ungültige QRL-Adresse (Q + 128 Hex-Zeichen)"),
  ).toBeTruthy();
  expect(screen.getByDisplayValue("Savings")).toBeTruthy();
  expect(screen.getByRole("dialog")).toBeTruthy();
});

it("updates an existing send outcome and preserves the hash and explorer target", async () => {
  const hash = `0x${"a".repeat(64)}`;
  render(
    <HelmetProvider>
      <SendStatus
        status={{
          state: "timeout",
          txHash: hash,
          receipt: null,
          error:
            "Still waiting for confirmation after 5 minutes. Check History or the explorer before sending again.",
        }}
        blockchain="TEST_NET"
        onBack={jest.fn()}
      />
    </HelmetProvider>,
  );
  const href = screen.getByRole("link").getAttribute("href");
  await act(() => applyLanguage("es"));
  expect(screen.getByRole("heading").textContent).toBe(
    "Firmada y enviada: aún esperando confirmación",
  );
  expect(screen.getByRole("link").getAttribute("href")).toBe(href);
  expect(screen.getByTitle(hash)).toBeTruthy();
  expect(screen.getByRole("status").textContent).toContain("5 minutos");
});

it("keeps the existing fee quote when changing language", async () => {
  jest.useFakeTimers();
  render(
    <GasFeeNotice
      from="sender"
      to="recipient"
      value="1"
      isSubmitting={false}
      feeLevel="medium"
      onFeeLevelChange={jest.fn()}
    />,
  );
  await act(async () => {
    await jest.advanceTimersByTimeAsync(600);
  });
  const amount = screen.getByText(/^≈/).textContent;
  await act(() => applyLanguage("de"));
  await act(async () => {
    await jest.advanceTimersByTimeAsync(600);
  });
  expect(screen.getByText("Netzwerkgebühr")).toBeTruthy();
  expect(screen.getByText(/^≈/).textContent).toBe(amount);
  // The store/provider fixture must stay stable across language renders.
  expect(mockEstimate).toHaveBeenCalledTimes(1);
});

it.each([1, 2, 5, 21])(
  "uses Russian cardinal plurals for %s remaining PIN attempts",
  async (count) => {
    await applyLanguage("ru");
    const t = i18n.getFixedT("ru", ["transfer", "common", "settings"] as const);
    const result = transferMessage(
      `Incorrect PIN. ${count} attempt${count === 1 ? "" : "s"} remaining.`,
      t,
    );
    expect(result).toContain(String(count));
    expect(result).toContain(
      count === 1 || count === 21
        ? "попытка"
        : count === 2
          ? "попытки"
          : "попыток",
    );
  },
);

it("keeps stored decimal precision errors live and preserves their original value", async () => {
  const message = transferError({
    key: "transfer:decimals",
    count: 6,
    digits: "06",
  });
  function ErrorMessage() {
    const { t } = useTranslation(["transfer", "common", "settings"] as const);
    return <p>{transferMessage(message, t)}</p>;
  }
  render(<ErrorMessage />);
  expect(
    screen.getByText("Enter an amount with at most 06 decimal places"),
  ).toBeTruthy();
  await act(() => applyLanguage("zh-CN"));
  expect(screen.getByText("输入最多 06 位小数的金额")).toBeTruthy();
});

it.each([
  "<script>alert(1)</script>",
  "Node says: transfer:seedMismatch",
  "",
  "Transaction failed: service reason <raw>",
])("preserves unknown runtime error data: %s", async (reason) => {
  await applyLanguage("de");
  const t = i18n.getFixedT("de", ["transfer", "common", "settings"] as const);
  const result = transferMessage(
    transferError({ key: "transfer:transferFailed", reason }),
    t,
  );
  expect(result).toBe(`Überweisung fehlgeschlagen: ${reason}`);
});
