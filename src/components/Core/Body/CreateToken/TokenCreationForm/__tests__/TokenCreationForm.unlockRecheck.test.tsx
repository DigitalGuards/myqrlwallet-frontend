/** @jest-environment jsdom */
// The PIN unlock takes a second or two. An account, network or provider
// change while it runs must stop the token creation before anything is
// signed or broadcast, and the PIN accounting must stay exactly as it was.
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { configure, observable, runInAction } from "mobx";
import { decryptStoredSeedWithPin } from "@/utils/crypto";
import {
  recordFailedAttempt,
  recordSuccessfulAttempt,
} from "@/utils/crypto/pinAttemptTracker";
import { deferred } from "@/test-utils/deferred";
import { TokenCreationForm } from "../TokenCreationForm";

configure({ enforceActions: "never" });

const ADDRESS = `Q${"1".repeat(128)}`;
const OTHER = `Q${"4".repeat(128)}`;

// Distinct contents: the store's struct comparer treats equal ones as one.
let providerCount = 0;
class FakeProvider {
  readonly id = ++providerCount;
}

let mockStore: {
  qrlStore: {
    activeAccount: { accountAddress: string };
    qrlConnection: { blockchain: string };
    qrlInstance: FakeProvider;
  };
  tokenStore: { setCreatingToken: jest.Mock };
};
const mockCreated = jest.fn(() => Promise.resolve());

jest.mock("@/stores/store", () => ({ useStore: () => mockStore }));
jest.mock("@/desktop/bridge", () => ({ isDesktop: false }));
jest.mock("@/utils", () =>
  jest.requireActual<typeof import("@/utils/cn")>("@/utils/cn"),
);
jest.mock("@/router/router", () => ({ ROUTES: { TOKEN_STATUS: "/status" } }));
jest.mock("react-router", () => ({ useNavigate: () => jest.fn() }));
jest.mock("@/components/Core/Layout/PageShell", () => ({
  PageShell: ({ children }: { children: ReactNode }) => children,
}));
jest.mock("@/config", () => ({ QRL_PROVIDER: { TEST_NET: {} } }));
jest.mock("@/config/runtimeProfile", () => ({
  IS_V3_PROFILE: false,
  profileStorageKey: (key: string) => key,
}));
jest.mock("@/utils/nativeApp", () => ({ isInNativeApp: () => false }));
jest.mock("@/utils/web3", () => ({ isValidQrlAddress: () => true }));
jest.mock("@/utils/reportError", () => ({ reportError: jest.fn() }));
jest.mock("@/utils/storage", () => ({
  StorageUtil: {
    getBlockChain: () => Promise.resolve("TEST_NET"),
    getEncryptedSeed: () => Promise.resolve("fixture"),
  },
}));
jest.mock("@/utils/crypto", () => ({
  decryptStoredSeedWithPin: jest.fn(),
  DeviceCredentialUnavailableError: class extends Error {},
  getAddressFromMnemonicAsync: () => Promise.resolve(`Q${"1".repeat(128)}`),
}));
// The real limiter and tracker run; the two writes are observed.
jest.mock("@/utils/crypto/pinAttemptTracker", () => ({
  ...jest.requireActual<typeof import("@/utils/crypto/pinAttemptTracker")>(
    "@/utils/crypto/pinAttemptTracker",
  ),
  recordSuccessfulAttempt: jest.fn(),
  recordFailedAttempt: jest.fn(),
}));
// Always current, so the check under test is the only thing that can stop
// the creation.
jest.mock("@/utils/nativeWalletMutation", () => ({
  walletMutations: { captureGeneration: () => 0, isCurrent: () => true },
}));
jest.mock("@/components/UI/PinInput/PinInput", () => ({
  PinInput: ({
    value,
    onChange,
    placeholder = "PIN",
  }: {
    value: string;
    onChange: (pin: string) => void;
    placeholder?: string;
  }) => (
    <input
      aria-label={placeholder}
      value={value}
      onChange={(event) => {
        onChange(event.target.value);
      }}
    />
  ),
}));

class MockResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
beforeEach(() => {
  globalThis.ResizeObserver = MockResizeObserver;
  localStorage.clear();
  mockStore = {
    qrlStore: observable(
      {
        activeAccount: { accountAddress: ADDRESS },
        activeAccountSource: "seed",
        qrlConnection: { blockchain: "TEST_NET" },
        qrlInstance: new FakeProvider(),
      },
      {
        activeAccount: observable.struct,
        qrlConnection: observable.struct,
        qrlInstance: observable.struct,
      },
    ),
    tokenStore: { setCreatingToken: jest.fn(() => Promise.resolve()) },
  };
});
afterEach(() => {
  cleanup();
  jest.clearAllMocks();
});

function fill(input: HTMLElement, value: string) {
  fireEvent.change(input, { target: { value } });
}

async function startCreation() {
  const unlock = deferred<{ mnemonic: string; hexSeed: string }>();
  jest.mocked(decryptStoredSeedWithPin).mockReturnValue(unlock.promise);
  render(<TokenCreationForm onTokenCreated={mockCreated} />);
  fill(screen.getByPlaceholderText("Example: MyQRLWallet"), "Token");
  fill(screen.getByPlaceholderText("Example: MQW"), "TOK");
  fill(screen.getByPlaceholderText("Example: 1000000000"), "1000");
  const pin = screen.getByLabelText("Enter your PIN");
  fill(pin, "123456");
  const form = pin.closest("form");
  if (!form) throw new Error("Form is missing");
  await act(() => {
    fireEvent.submit(form);
    return Promise.resolve();
  });
  await waitFor(() => {
    expect(decryptStoredSeedWithPin).toHaveBeenCalledTimes(1);
  });
  return unlock;
}

it.each<[string, () => void]>([
  ["account", () => { mockStore.qrlStore.activeAccount = { accountAddress: OTHER }; }],
  ["network", () => { mockStore.qrlStore.qrlConnection = { blockchain: "MAIN_NET" }; }],
  ["provider", () => { mockStore.qrlStore.qrlInstance = new FakeProvider(); }],
])("creates nothing when the %s changes during the unlock", async (_name, change) => {
  const unlock = await startCreation();
  act(() => { runInAction(change); });
  await act(async () => {
    unlock.resolve({ mnemonic: "fixture", hexSeed: "00" });
    await Promise.resolve();
  });
  expect(
    await screen.findByText(
      "An error occurred while creating the token. Please try again.",
    ),
  ).toBeTruthy();
  expect(mockCreated).not.toHaveBeenCalled();
  expect(mockStore.tokenStore.setCreatingToken).not.toHaveBeenCalled();
  expect(recordFailedAttempt).not.toHaveBeenCalled();
  expect(recordSuccessfulAttempt).toHaveBeenCalledTimes(1);
});

it("creates exactly once when nothing changes", async () => {
  const unlock = await startCreation();
  await act(async () => {
    unlock.resolve({ mnemonic: "fixture", hexSeed: "00" });
    await Promise.resolve();
  });
  await waitFor(() => {
    expect(mockCreated).toHaveBeenCalledTimes(1);
  });
  expect(recordSuccessfulAttempt).toHaveBeenCalledTimes(1);
  expect(recordFailedAttempt).not.toHaveBeenCalled();
});
