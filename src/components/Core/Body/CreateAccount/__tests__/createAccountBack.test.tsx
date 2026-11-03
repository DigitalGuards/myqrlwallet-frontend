/** @jest-environment jsdom */
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import CreateAccount from "../CreateAccount";

/**
 * Create account holds its Back while the new wallet is stored. The
 * recovery phrase shows no Back, and the page keeps it held there for
 * Android back: by then the wallet exists, and the phrase screen's own Done
 * asks for the backup first.
 */

const mockAddress = `Q${"12".repeat(64)}`;
let mockActiveAddress = "";
const mockStore = {
  qrlStore: {
    qrlConnection: { blockchain: "TEST_NET" },
    get activeAccount() {
      return { accountAddress: mockActiveAddress };
    },
    setActiveAccount: jest.fn((next: string) => {
      mockActiveAddress = next;
      return Promise.resolve();
    }),
  },
};
jest.mock("@/stores/store", () => ({ useStore: () => mockStore }));
jest.mock("mobx-react-lite", () => ({
  observer: (component: unknown) => component,
}));
jest.mock("@/utils", () =>
  jest.requireActual<typeof import("@/utils/cn")>("@/utils/cn"),
);
jest.mock("@/components/SEO/SEO", () => ({ SEO: () => null }));
jest.mock("@/hooks/useWalletLimit", () => ({
  useWalletLimit: () => ({ isWalletLimitReached: false }),
}));
jest.mock("react-router", () => ({
  Link: ({ children }: { children: ReactNode }) => children,
}));
jest.mock("@/router/router", () => ({
  ROUTES: { CREATE_ACCOUNT: "/create-account" },
}));
jest.mock("@/components/Core/Layout/PageBack", () => ({
  PageBack: () => null,
  RouteBack: ({
    route,
    disabled,
    hidden,
    hasWallet,
  }: {
    route: string;
    disabled?: boolean;
    hidden?: boolean;
    hasWallet?: boolean;
  }) => (
    <span
      data-testid="route-back"
      data-route={route}
      data-held={String(disabled === true)}
      data-hidden={String(hidden === true)}
      data-has-wallet={String(hasWallet === true)}
    />
  ),
}));
jest.mock("../AccountCreationForm/AccountCreationForm", () => ({
  AccountCreationForm: ({
    onAccountCreated,
    onBusyChange,
  }: {
    onAccountCreated: (account: { address: string }, password: string) => Promise<void>;
    onBusyChange?: (busy: boolean) => void;
  }) => (
    <>
      <button type="button" onClick={() => onBusyChange?.(true)}>
        Start
      </button>
      <button type="button" onClick={() => onBusyChange?.(false)}>
        Fail
      </button>
      <button
        type="button"
        onClick={() => {
          void onAccountCreated({ address: mockAddress }, "Password1!");
        }}
      >
        Finish
      </button>
    </>
  ),
}));
jest.mock("../MnemonicDisplay/MnemonicDisplay", () => ({
  __esModule: true,
  default: () => <p>Recovery phrase</p>,
}));

const back = () => screen.getByTestId("route-back").dataset;

beforeEach(() => {
  mockActiveAddress = "";
  window.scrollTo = jest.fn();
});
afterEach(cleanup);

it("goes back to onboarding before the first wallet, and to Wallets after", () => {
  const view = render(<CreateAccount />);
  expect(back()["route"]).toBe("/create-account");
  expect(back()["hasWallet"]).toBe("false");
  view.unmount();
  mockActiveAddress = mockAddress;
  render(<CreateAccount />);
  expect(back()["hasWallet"]).toBe("true");
});

it("holds Back while the wallet is stored, and hides it on the recovery phrase", async () => {
  render(<CreateAccount />);
  expect(back()["held"]).toBe("false");
  expect(back()["hidden"]).toBe("false");

  fireEvent.click(screen.getByRole("button", { name: "Start" }));
  expect(back()["held"]).toBe("true");
  // Shown and disabled while the wallet is stored.
  expect(back()["hidden"]).toBe("false");

  // A failed submission releases it.
  fireEvent.click(screen.getByRole("button", { name: "Fail" }));
  expect(back()["held"]).toBe("false");

  fireEvent.click(screen.getByRole("button", { name: "Start" }));
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Finish" }));
    await Promise.resolve();
  });
  await screen.findByText("Recovery phrase");
  // No control on the phrase, and still held for Android back.
  expect(back()["hidden"]).toBe("true");
  expect(back()["held"]).toBe("true");
});
