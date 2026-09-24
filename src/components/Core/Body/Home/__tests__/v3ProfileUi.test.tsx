/** @jest-environment jsdom */

import type { ReactNode } from "react";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { connectWithProvider, discoverQrlProviders } from "@/utils/extension";
import { startMobilePairing } from "@/utils/mobileConnect/mobileConnection";
import ConnectionBadge from "../ConnectionBadge/ConnectionBadge";
import AccountCreateImport from "../AccountCreateImport/AccountCreateImport";
import { NetworkSettings } from "../../Settings/NetworkSettings/NetworkSettings";

let mockV3Profile = false;
let mockNativeApp = false;
const mockNavigate = jest.fn();
const mockUnsupportedMessage =
  "Extension and mobile signers are unavailable for private v3.";
const mockDefaultNetworks = [
  {
    id: "TEST_NET",
    name: "QRL Testnet",
    url: "https://wallet.example/testnet",
    explorer: "https://explorer.example",
  },
  {
    id: "MAIN_NET",
    name: "QRL Mainnet",
    url: "https://wallet.example/mainnet",
    explorer: "https://explorer.example",
  },
];
const mockV3Network = {
  id: "TEST_NET_V3",
  name: "QRL Testnet v3 (Private)",
  url: "https://wallet.example/v3",
  explorer: "https://explorer.example/v3",
};
const mockStore = {
  qrlStore: {
    activeAccount: { accountAddress: "" },
    activeAccountSource: "local",
    setActiveAccount: jest.fn(),
    setExtensionProvider: jest.fn(),
    selectBlockchain: jest.fn(),
    qrlConnection: {
      blockchain: "TEST_NET",
      qrlNetworkName: "QRL Testnet",
      isLoading: false,
      isConnected: true,
    },
  },
};

jest.mock("@/config", () => ({
  get IS_V3_PROFILE() {
    return mockV3Profile;
  },
  get AVAILABLE_NETWORKS() {
    return mockV3Profile ? [mockV3Network] : mockDefaultNetworks;
  },
}));
jest.mock("@/config/runtimeProfile", () => ({
  get IS_V3_PROFILE() {
    return mockV3Profile;
  },
  get V3_UNSUPPORTED_SIGNER_MESSAGE() {
    return mockUnsupportedMessage;
  },
}));
jest.mock("@/stores/store", () => ({ useStore: () => mockStore }));
jest.mock("mobx-react-lite", () => ({
  observer: (component: unknown) => component,
}));
jest.mock("@/utils", () => ({
  cn: (...values: unknown[]) => values.filter(Boolean).join(" "),
}));
jest.mock("@/utils/extension", () => ({
  connectWithProvider: jest.fn(),
  discoverQrlProviders: jest.fn(),
}));
jest.mock("@/utils/mobileConnect/mobileConnection", () => ({
  cancelMobilePairing: jest.fn(),
  startMobilePairing: jest.fn(),
}));
jest.mock("../AccountCreateImport/ExtensionPickerDialog", () => () => null);
jest.mock("../AccountCreateImport/MobilePairingDialog", () => () => null);
jest.mock("@/utils/nativeApp", () => ({ isInNativeApp: () => mockNativeApp }));
jest.mock("@/desktop/bridge", () => ({ isDesktop: false }));
jest.mock("@/router/router", () => ({
  ROUTES: {
    HOME: "/",
    CREATE_ACCOUNT: "/create-account",
    IMPORT_ACCOUNT: "/import-account",
  },
}));
jest.mock("react-router", () => ({
  Link: ({
    children,
    to,
    className,
  }: {
    children: ReactNode;
    to: string;
    className?: string;
  }) => (
    <a href={to} className={className}>
      {children}
    </a>
  ),
  useLocation: () => ({ state: null }),
  useNavigate: () => mockNavigate,
}));

beforeEach(() => {
  jest.clearAllMocks();
  mockV3Profile = false;
  mockNativeApp = false;
  Object.assign(mockStore.qrlStore.qrlConnection, {
    blockchain: "TEST_NET",
    qrlNetworkName: "QRL Testnet",
    isLoading: false,
    isConnected: true,
  });
});
afterEach(cleanup);

function selectV3Profile() {
  mockV3Profile = true;
  mockStore.qrlStore.qrlConnection.blockchain = mockV3Network.id;
  mockStore.qrlStore.qrlConnection.qrlNetworkName = mockV3Network.name;
}

function openNetworkMenu() {
  const trigger = screen.getByRole("button", { name: /^Network:/ });
  fireEvent.keyDown(trigger, { key: "ArrowDown" });
}

it("shows private v3 on the closed badge and exposes only its configured network", async () => {
  selectV3Profile();
  render(<ConnectionBadge />);
  expect(
    screen.getByRole("button", { name: `Network: ${mockV3Network.name}` })
      .textContent,
  ).toContain("v3 Private");
  expect(screen.queryByRole("menuitem")).toBeNull();
  openNetworkMenu();
  const item = await screen.findByRole("menuitem", {
    name: mockV3Network.name,
  });
  expect(screen.getAllByRole("menuitem")).toHaveLength(1);
  fireEvent.click(item);
  expect(mockStore.qrlStore.selectBlockchain).toHaveBeenCalledWith(
    "TEST_NET_V3",
  );
});

it("preserves both default badge network choices", async () => {
  render(<ConnectionBadge />);
  expect(screen.queryByText("v3 Private")).toBeNull();
  openNetworkMenu();
  const item = await screen.findByRole("menuitem", { name: "QRL Mainnet" });
  expect(screen.getAllByRole("menuitem")).toHaveLength(2);
  fireEvent.click(item);
  expect(mockStore.qrlStore.selectBlockchain).toHaveBeenCalledWith("MAIN_NET");
});

it("keeps network menu selection disabled while the connection is loading", async () => {
  selectV3Profile();
  mockStore.qrlStore.qrlConnection.isLoading = true;
  render(<ConnectionBadge />);
  openNetworkMenu();
  const item = await screen.findByRole("menuitem", {
    name: mockV3Network.name,
  });
  expect(item.getAttribute("aria-disabled")).toBe("true");
});

it("renders only the full private v3 label in network settings", () => {
  selectV3Profile();
  render(<NetworkSettings />);
  const option = screen.getByRole("button", { name: mockV3Network.name });
  expect(screen.getAllByRole("button")).toHaveLength(1);
  fireEvent.click(option);
  expect(mockStore.qrlStore.selectBlockchain).toHaveBeenCalledWith(
    "TEST_NET_V3",
  );
});

it("preserves default settings labels, ordering, and network selection", () => {
  render(<NetworkSettings />);
  expect(
    screen.getAllByRole("button").map((button) => button.textContent),
  ).toEqual(["Mainnet", "Testnet"]);
  fireEvent.click(screen.getByRole("button", { name: "Mainnet" }));
  fireEvent.click(screen.getByRole("button", { name: "Testnet" }));
  expect(mockStore.qrlStore.selectBlockchain.mock.calls).toEqual([
    ["MAIN_NET"],
    ["TEST_NET"],
  ]);
});

it("keeps network settings disabled while the connection is loading", () => {
  selectV3Profile();
  mockStore.qrlStore.qrlConnection.isLoading = true;
  render(<NetworkSettings />);
  const option = screen.getByRole("button", { name: mockV3Network.name });
  expect(option).toHaveProperty("disabled", true);
  fireEvent.click(option);
  expect(mockStore.qrlStore.selectBlockchain).not.toHaveBeenCalled();
});

it("enables v3 create/import, extension and mobile pairing", async () => {
  jest.mocked(startMobilePairing).mockResolvedValue({
    redirected: true,
    uri: "qrlconnect://test",
    installHint: null,
  });
  selectV3Profile();
  render(<AccountCreateImport />);
  for (const name of ["Create a new account", "Import an existing account"]) {
    expect(screen.getByRole("button", { name })).toHaveProperty(
      "disabled",
      false,
    );
  }
  expect(
    screen
      .getByRole("link", { name: "Create a new account" })
      .getAttribute("href"),
  ).toBe("/create-account");
  expect(
    screen
      .getByRole("link", { name: "Import an existing account" })
      .getAttribute("href"),
  ).toBe("/import-account");
  expect(
    screen.getByRole("button", { name: "Connect Browser Extension" }),
  ).toHaveProperty("disabled", false);
  const mobile = screen.getByRole("button", { name: "Connect Mobile App" });
  expect(mobile).toHaveProperty("disabled", false);
  expect(screen.queryByText(mockUnsupportedMessage)).toBeNull();
  expect(discoverQrlProviders).not.toHaveBeenCalled();
  expect(connectWithProvider).not.toHaveBeenCalled();
  fireEvent.click(mobile);
  await waitFor(() =>
    expect(startMobilePairing).toHaveBeenCalledWith(mockStore.qrlStore, false),
  );
});

it("preserves enabled default-profile extension and mobile connection actions", async () => {
  jest.mocked(discoverQrlProviders).mockResolvedValue([]);
  jest.mocked(startMobilePairing).mockResolvedValue({
    redirected: true,
    uri: "qrlconnect://test",
    installHint: null,
  });
  const alert = jest.spyOn(window, "alert").mockImplementation(() => undefined);
  const log = jest.spyOn(console, "error").mockImplementation(() => undefined);
  try {
    render(<AccountCreateImport />);
    const extension = screen.getByRole("button", {
      name: "Connect Browser Extension",
    });
    const mobile = screen.getByRole("button", { name: "Connect Mobile App" });
    expect(extension).toHaveProperty("disabled", false);
    expect(mobile).toHaveProperty("disabled", false);
    expect(screen.queryByText(mockUnsupportedMessage)).toBeNull();
    fireEvent.click(extension);
    await waitFor(() => expect(discoverQrlProviders).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(alert).toHaveBeenCalledTimes(1));
    fireEvent.click(mobile);
    await waitFor(() =>
      expect(startMobilePairing).toHaveBeenCalledWith(
        mockStore.qrlStore,
        false,
      ),
    );
  } finally {
    alert.mockRestore();
    log.mockRestore();
  }
});

it("preserves native-app hiding of external signer controls", () => {
  mockNativeApp = true;
  render(<AccountCreateImport />);
  expect(
    screen.queryByRole("button", { name: "Connect Browser Extension" }),
  ).toBeNull();
  expect(
    screen.queryByRole("button", { name: "Connect Mobile App" }),
  ).toBeNull();
  expect(
    screen.getByRole("button", { name: "Create a new account" }),
  ).toHaveProperty("disabled", false);
});
