/** @jest-environment jsdom */
// English oracle: run this unchanged harness on an archive of origin/dev
// 0aadae9ed5cdb3dec24cf43e7c104c9b0d3646ce. Never update from converted code.
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import type { AnchorHTMLAttributes, ReactElement } from "react";
import { HelmetProvider } from "react-helmet-async";
import CreateToken from "@/components/Core/Body/CreateToken/CreateToken";
import TokenStatus from "@/components/Core/Body/CreateToken/TokenStatus";
import NftDetail from "@/components/Core/Body/Nfts/NftDetail";
import { AddNftModal } from "@/components/Core/Body/Nfts/AddNftModal";
import type { NFTInterface } from "@/constants/nft";
import type { TransactionStatus } from "@/stores/qrlStore";
import { PinVerificationError } from "@/utils/crypto/verifyPinWithLimit";
import { DeviceCredentialUnavailableError } from "@/utils/crypto";
import { deferred } from "@/test-utils/deferred";

const FROM = `Q${"1".repeat(128)}`;
const mockTo = `Q${"2".repeat(128)}`;
const mockContract = `Q${"3".repeat(128)}`;
const HASH = `0x${"a".repeat(64)}`;
let mockDesktop = false;
let mockStoredSeed: string | null = "fixture";
let mockSender = FROM;
let mockCurrent = true;
let mockCapture = true;
let mockRevalidate = true;
let mockRecipient = mockTo;
let mockMessage: string | null = "Recipient address verified.";
const mockDecrypt = jest.fn<Promise<{ mnemonic: string }>, []>();
const mockTransfer = jest.fn<Promise<boolean>, unknown[]>();
const mockDetect = jest.fn<Promise<"ERC721" | "ERC1155" | null>, []>();
const mockEnumerate = jest.fn<Promise<string[] | null>, []>();
const mockOwner = jest.fn<Promise<boolean>, []>();
const mockBalance = jest.fn<Promise<bigint>, []>();
const mockAdd = jest.fn<Promise<void>, unknown[]>();
const mockPicks = jest.fn<Promise<void>, unknown[]>();
const mockClose = jest.fn();
const mockNavigate = jest.fn();
const mockCopy = jest.fn<Promise<boolean>, [string]>();
let mockEnumerable = true;
const nft = (): NFTInterface => ({
  contractAddress: mockContract,
  tokenId: "42",
  standard: "ERC1155",
  balance: "7",
  name: "Untranslated NFT",
  collectionName: "Collection example",
  collectionSymbol: "EX",
  description: "Metadata <b>stays</b> verbatim",
  image: undefined,
});
function connectedInstance(): object | null {
  return {};
}
function idleStatus(): TransactionStatus {
  return { state: "idle", txHash: null, receipt: null, error: null };
}
function pendingCollections(): {
  key: string;
  name: string;
  symbol: string;
  contractAddress: string;
  tokenCount: number;
  tokens: NFTInterface[];
  standard: "ERC1155";
  truncated: boolean;
}[] {
  return [];
}
function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error("Missing fixture value");
  return value;
}
function fixture() {
  return {
    qrlStore: {
      activeAccount: { accountAddress: FROM },
      activeAccountSource: "seed",
      qrlConnection: { blockchain: "TEST_NET" },
      qrlInstance: connectedInstance(),
      transactionStatus: idleStatus(),
      resetTransactionStatus: jest.fn(),
    },
    tokenStore: {
      createToken: jest
        .fn<Promise<void>, unknown[]>()
        .mockResolvedValue(undefined),
      setCreatingToken: jest
        .fn<Promise<void>, unknown[]>()
        .mockResolvedValue(undefined),
      addToken: jest
        .fn<Promise<void>, unknown[]>()
        .mockResolvedValue(undefined),
      creatingToken: { name: "Untranslated Token", creating: false, error: "" },
      createdToken: {
        name: "Untranslated Token",
        symbol: "EX",
        decimals: 18,
        address: "",
        tx: HASH,
        blockHash: HASH,
        blockNumber: 42,
        gasUsed: "21000",
        effectiveGasPrice: "1000000000",
      },
    },
    nftStore: {
      nftList: [nft()],
      pendingDiscoveredNftCollections: pendingCollections(),
      discoverNftsForReview: jest.fn().mockResolvedValue(undefined),
      addNft: mockAdd,
      addDiscoveredCollections: mockPicks,
      transferNft: mockTransfer,
    },
  };
}
let mockStore = fixture();
jest.mock("@/stores/store", () => ({ useStore: () => mockStore }));
jest.mock("mobx-react-lite", () => ({
  observer: (component: unknown) => component,
}));
jest.mock("react-router", () => ({
  useNavigate: () => mockNavigate,
  useLocation: () => ({ state: null }),
  useParams: () => ({ contractAddress: mockContract, tokenId: "42" }),
  Link: ({
    to,
    ...props
  }: AnchorHTMLAttributes<HTMLAnchorElement> & { to: string }) => (
    <a href={to} {...props} />
  ),
}));
jest.mock("@/router/router", () => ({
  ROUTES: {
    HOME: "/",
    CREATE_TOKEN: "/create-token",
    TOKEN_STATUS: "/token-status",
    IMPORT_ACCOUNT: "/import-account",
  },
}));
jest.mock("@/utils", () =>
  jest.requireActual<typeof import("@/utils/cn")>("@/utils/cn"),
);
jest.mock("@/config", () => ({
  QRL_PROVIDER: {
    TEST_NET: {
      url: "https://rpc.example",
      explorer: "https://explorer.example",
    },
  },
}));
jest.mock("@/config/runtimeProfile", () => ({
  IS_V3_PROFILE: false,
  profileStorageKey: (key: string) => key,
}));
jest.mock("@/utils/storage", () => ({
  StorageUtil: {
    getBlockChain: () => Promise.resolve("TEST_NET"),
    getEncryptedSeed: () => Promise.resolve(mockStoredSeed),
  },
}));
jest.mock("@/utils/nativeApp", () => ({
  isInNativeApp: () => false,
  copyToClipboard: (value: string) => mockCopy(value),
  triggerHaptic: jest.fn(),
}));
jest.mock("@/desktop/bridge", () => ({
  get isDesktop() {
    return mockDesktop;
  },
}));
jest.mock("@/utils/crypto", () => ({
  DeviceCredentialUnavailableError: class extends Error {},
  decryptStoredSeedWithPin: () => mockDecrypt(),
  getAddressFromMnemonicAsync: () => Promise.resolve(mockSender),
}));
jest.mock("@/utils/crypto/verifyPinWithLimit", () => ({
  ...jest.requireActual<typeof import("@/utils/crypto/verifyPinWithLimit")>(
    "@/utils/crypto/verifyPinWithLimit",
  ),
  verifyPinWithLimit: (decrypt: () => Promise<unknown>) => decrypt(),
}));
jest.mock("@/utils/nativeWalletMutation", () => ({
  walletMutations: {
    captureGeneration: () => ({ revision: 1 }),
    isCurrent: () => mockCurrent,
  },
}));
jest.mock("@/utils/web3", () => ({
  QRL_ZERO_ADDRESS: `Q${"0".repeat(128)}`,
  isValidQrlAddress: (value: string) => /^Q[0-9a-f]{128}$/i.test(value),
}));
jest.mock("@/hooks/useNetworkQrnsRecipient", () => ({
  useNetworkQrnsRecipient: () => ({
    status: "resolved",
    address: mockRecipient,
    normalizedName: null,
    message: mockMessage,
    bindingKey: "fixture",
    captureSubmission: () =>
      mockCapture
        ? {
            address: mockRecipient,
            input: mockRecipient,
            bindingKey: "fixture",
          }
        : null,
    revalidateSubmission: () => (mockRevalidate ? mockRecipient : null),
  }),
}));
jest.mock("@/utils/web3/nft", () => ({
  detectTokenStandard: () => mockDetect(),
  fetchNftCollectionInfo: () =>
    Promise.resolve({
      name: "Collection example",
      symbol: "EX",
      supportsEnumerable: mockEnumerable,
    }),
  fetchOwned721Ids: () => mockEnumerate(),
  isErc721Owner: () => mockOwner(),
  fetchErc1155Balance: () => mockBalance(),
  fetchTokenUri: () => Promise.resolve("https://metadata.example/42"),
  fetchNftMetadata: () =>
    Promise.resolve({
      name: "Untranslated NFT",
      description: "Metadata <b>stays</b> verbatim",
    }),
}));

class ResizeObserverFixture {
  observe() {}
  unobserve() {}
  disconnect() {}
}
beforeEach(() => {
  Object.defineProperty(globalThis, "ResizeObserver", {
    configurable: true,
    value: ResizeObserverFixture,
  });
  jest.clearAllMocks();
  jest.spyOn(console, "error").mockImplementation(() => undefined);
  mockDesktop = false;
  mockStoredSeed = "fixture";
  mockSender = FROM;
  mockCurrent = true;
  mockCapture = true;
  mockRevalidate = true;
  mockRecipient = mockTo;
  mockMessage = "Recipient address verified.";
  mockEnumerable = true;
  mockDecrypt.mockResolvedValue({ mnemonic: "fixture" });
  mockTransfer.mockResolvedValue(true);
  mockDetect.mockResolvedValue("ERC721");
  mockEnumerate.mockResolvedValue(["42"]);
  mockOwner.mockResolvedValue(true);
  mockBalance.mockResolvedValue(7n);
  mockAdd.mockResolvedValue(undefined);
  mockPicks.mockResolvedValue(undefined);
  mockCopy.mockResolvedValue(true);
  mockStore = fixture();
});
afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});
async function show(element: ReactElement) {
  await act(async () => {
    await Promise.resolve();
    render(<HelmetProvider>{element}</HelmetProvider>);
  });
}
function snapshot() {
  const copy = document.body.cloneNode(true);
  if (!(copy instanceof HTMLElement)) throw new Error("Missing body");
  copy
    .querySelectorAll("style, script, [hidden], [aria-hidden=true], .sr-only")
    .forEach((element) => {
      element.remove();
    });
  expect({
    text: copy.textContent,
    labels: [
      ...copy.querySelectorAll("[aria-label], [title], [alt], [placeholder]"),
    ].map((element) =>
      ["aria-label", "title", "alt", "placeholder"].flatMap((name) =>
        element.hasAttribute(name) ? [[name, element.getAttribute(name)]] : [],
      ),
    ),
    values: [...copy.querySelectorAll("input")].map((input) => input.value),
    title: document.title,
  }).toMatchSnapshot();
}
async function change(element: HTMLElement, value: string) {
  await act(async () => {
    await Promise.resolve();
    fireEvent.change(element, { target: { value } });
  });
}
async function click(name: string) {
  await act(async () => {
    await Promise.resolve();
    fireEvent.click(screen.getByRole("button", { name }));
  });
}
async function pin(value = "123456") {
  for (const [index, digit] of Array.from(value).entries())
    await change(screen.getByLabelText(`PIN digit ${index + 1}`), digit);
}
async function submit() {
  const form = document.querySelector("form");
  if (!form) throw new Error("Missing form");
  await act(async () => {
    await Promise.resolve();
    fireEvent.submit(form);
  });
}
async function creation() {
  await show(<CreateToken />);
  await change(
    screen.getByPlaceholderText("Example: MyQRLWallet"),
    "Untranslated Token",
  );
  await change(screen.getByPlaceholderText("Example: MQW"), "EX");
}

it.each(["empty", "seed", "extension", "mobile", "desktop"])(
  "creation %s",
  async (source) => {
    if (source === "empty")
      mockStore.qrlStore.activeAccount.accountAddress = "";
    else if (source === "desktop") mockDesktop = true;
    else mockStore.qrlStore.activeAccountSource = source;
    await show(<CreateToken />);
    snapshot();
  },
);
it("creation all fields and real value", async () => {
  await creation();
  for (const name of [
    "Mintable",
    "Change Initial recipient",
    "Max Wallet Amount",
    "Max Transaction Limit",
  ])
    await act(async () => {
      await Promise.resolve();
      fireEvent.click(screen.getByRole("checkbox", { name }));
    });
  await change(
    required(
      screen.getAllByPlaceholderText("Example: 999,999,999,999,999,999")[0],
    ),
    "1000000000000000000",
  );
  snapshot();
  await change(
    required(
      screen.getAllByPlaceholderText("Example: 999,999,999,999,999,999")[0],
    ),
    "invalid",
  );
  snapshot();
});
it.each(["required", "profanity", "decimals", "recipient"])(
  "creation validation %s",
  async (kind) => {
    await creation();
    if (kind === "required") {
      await change(screen.getByPlaceholderText("Example: MyQRLWallet"), "");
      await change(screen.getByPlaceholderText("Example: MQW"), "");
    }
    if (kind === "profanity") {
      await change(screen.getByPlaceholderText("Example: MyQRLWallet"), "fuck");
      await change(screen.getByPlaceholderText("Example: MQW"), "fuck");
    }
    if (kind === "decimals")
      await change(screen.getByPlaceholderText("Example: 18"), "0");
    if (kind === "recipient") {
      await act(async () => {
        await Promise.resolve();
        fireEvent.click(
          screen.getByRole("checkbox", { name: "Change Initial recipient" }),
        );
      });
      await change(
        screen.getByPlaceholderText("Q followed by 128 hex characters"),
        "invalid",
      );
    }
    await submit();
    snapshot();
  },
);
const securityCases = [
  "pin",
  "no-seed",
  "wrong-pin",
  "locked",
  "busy",
  "credential",
  "unlock",
  "disconnected",
  "wrong-wallet",
  "changed",
  "recipient-changed",
  "external",
  "non-error",
  "failed",
  "failed-reason",
  "extension",
  "desktop",
  "sending",
] as const;
it.each(
  securityCases.filter(
    (kind) =>
      !["recipient-changed", "failed", "failed-reason", "sending"].includes(
        kind,
      ),
  ),
)("creation security %s", async (kind) => {
  configure(kind);
  await creation();
  if (kind !== "pin" && kind !== "desktop" && kind !== "extension") await pin();
  await submit();
  snapshot();
});
function configure(kind: string) {
  if (kind === "no-seed") mockStoredSeed = null;
  if (kind === "wrong-pin")
    mockDecrypt.mockRejectedValue(
      new PinVerificationError({
        isLocked: false,
        remainingMs: 0,
        attemptsLeft: 2,
      }),
    );
  if (kind === "locked")
    mockDecrypt.mockRejectedValue(
      new PinVerificationError({
        isLocked: true,
        remainingMs: 120000,
        attemptsLeft: 0,
      }),
    );
  if (kind === "busy")
    mockDecrypt.mockRejectedValue(
      new PinVerificationError(
        { isLocked: false, remainingMs: 0, attemptsLeft: 3 },
        "Another PIN check is still running. Please try again.",
      ),
    );
  if (kind === "credential")
    mockDecrypt.mockRejectedValue(new DeviceCredentialUnavailableError());
  if (kind === "unlock")
    mockDecrypt.mockRejectedValue(new Error("WebCrypto detail"));
  if (kind === "disconnected") mockStore.qrlStore.qrlInstance = null;
  if (kind === "wrong-wallet") mockSender = mockTo;
  if (kind === "changed") mockCurrent = false;
  if (kind === "recipient-changed") mockRevalidate = false;
  if (kind === "external") {
    mockTransfer.mockRejectedValue(new Error("Node detail <b>0xff</b>"));
    mockStore.tokenStore.setCreatingToken.mockRejectedValue(
      new Error("Node detail"),
    );
  }
  if (kind === "non-error") {
    mockTransfer.mockRejectedValue(42);
    mockStore.tokenStore.setCreatingToken.mockRejectedValue(42);
  }
  if (kind === "failed" || kind === "failed-reason") {
    mockTransfer.mockResolvedValue(false);
    if (kind === "failed-reason")
      mockStore.qrlStore.transactionStatus.error =
        "NFT transfer failed: signer detail 0xff";
  }
  if (kind === "extension")
    mockStore.qrlStore.activeAccountSource = "extension";
  if (kind === "desktop") mockDesktop = true;
}
it.each(["idle", "creating", "error", "success"])(
  "token status %s",
  async (state) => {
    mockStore.tokenStore.creatingToken.creating = state === "creating";
    mockStore.tokenStore.creatingToken.error =
      state === "error" ? "Node detail <b>0xff</b>" : "";
    mockStore.tokenStore.createdToken.address =
      state === "success" ? mockContract : "";
    await show(<TokenStatus />);
    snapshot();
    if (state === "success") {
      for (const button of document.querySelectorAll("button")) {
        if (!button.textContent)
          await act(async () => {
            await Promise.resolve();
            fireEvent.click(button);
          });
      }
      snapshot();
    }
  },
);
it.each([
  "missing",
  "721",
  "1155",
  "fallback",
  "pending",
  "confirmed",
  "desktop",
  "extension",
])("NFT detail %s", async (kind) => {
  if (kind === "missing") mockStore.nftStore.nftList = [];
  const token = mockStore.nftStore.nftList[0];
  if (token && kind === "721") token.standard = "ERC721";
  if (token && kind === "fallback") {
    token.name = undefined;
    token.description = undefined;
    token.collectionName = undefined;
  }
  if (kind === "desktop") mockDesktop = true;
  if (kind === "extension")
    mockStore.qrlStore.activeAccountSource = "extension";
  if (kind === "pending" || kind === "confirmed") {
    mockStore.qrlStore.transactionStatus.state = kind;
    mockStore.qrlStore.transactionStatus.txHash = HASH;
  }
  await show(<NftDetail />);
  snapshot();
});
it.each([
  "recipient",
  "recipient-fallback",
  "self",
  "fraction",
  "zero",
  "negative",
  "balance",
  ...securityCases,
])("NFT transfer %s", async (kind) => {
  configure(kind);
  if (kind === "recipient" || kind === "recipient-fallback") {
    mockCapture = false;
    if (kind === "recipient-fallback") mockMessage = null;
  }
  if (kind === "self") mockRecipient = FROM;
  const pending = deferred<boolean>();
  if (kind === "sending") mockTransfer.mockReturnValue(pending.promise);
  await show(<NftDetail />);
  await change(
    screen.getByLabelText("Recipient address or QNS name"),
    mockRecipient,
  );
  const amount = { fraction: "1.5", zero: "0", negative: "-1", balance: "8" }[
    kind
  ];
  if (amount) await change(screen.getByLabelText("Amount"), amount);
  if (kind !== "pin" && kind !== "desktop" && kind !== "extension") await pin();
  await submit();
  snapshot();
  if (kind === "sending")
    await act(async () => {
      await Promise.resolve();
      pending.resolve(true);
    });
});
it("ERC721 amount guard after changing displayed standard", async () => {
  await show(<NftDetail />);
  await change(screen.getByLabelText("Amount"), "2");
  required(mockStore.nftStore.nftList[0]).standard = "ERC721";
  await submit();
  snapshot();
});
async function detect(standard: "ERC721" | "ERC1155" = "ERC721") {
  mockDetect.mockResolvedValue(standard);
  await show(<AddNftModal isOpen onClose={mockClose} />);
  await change(screen.getByLabelText("Contract Address"), mockContract);
}
it("NFT import empty", async () => {
  await show(<AddNftModal isOpen onClose={mockClose} />);
  snapshot();
});
it("NFT import detecting", async () => {
  const pending = deferred<"ERC721" | null>();
  mockDetect.mockReturnValue(pending.promise);
  await show(<AddNftModal isOpen onClose={mockClose} />);
  await change(screen.getByLabelText("Contract Address"), mockContract);
  snapshot();
  await act(async () => {
    await Promise.resolve();
    pending.resolve(null);
  });
  snapshot();
});
it.each(["reason", "non-error"])("NFT detection failure %s", async (kind) => {
  mockDetect.mockRejectedValue(
    kind === "reason" ? new Error("RPC detail 0xff") : 42,
  );
  await show(<AddNftModal isOpen onClose={mockClose} />);
  await change(screen.getByLabelText("Contract Address"), mockContract);
  snapshot();
});
it.each([
  "enumerated",
  "manual",
  "1155",
  "no-account",
  "empty",
  "missing-id",
  "wrong-owner",
  "1155-id",
  "zero",
  "failure",
  "non-error",
  "adding",
])("NFT import %s", async (kind) => {
  const standard = ["1155", "1155-id", "zero"].includes(kind)
    ? "ERC1155"
    : "ERC721";
  if (["manual", "missing-id", "wrong-owner"].includes(kind)) {
    mockEnumerable = false;
    mockEnumerate.mockResolvedValue(null);
  }
  if (kind === "no-account")
    mockStore.qrlStore.activeAccount.accountAddress = "";
  if (kind === "empty") mockEnumerate.mockResolvedValue([]);
  if (kind === "wrong-owner") mockOwner.mockResolvedValue(false);
  if (kind === "zero") mockBalance.mockResolvedValue(0n);
  if (kind === "failure")
    mockAdd.mockRejectedValue(new Error("Storage detail 0xff"));
  if (kind === "non-error") mockAdd.mockRejectedValue(42);
  const pending = deferred<undefined>();
  if (kind === "adding") mockAdd.mockReturnValue(pending.promise);
  await detect(standard);
  snapshot();
  if (["manual", "wrong-owner", "1155", "zero"].includes(kind))
    await change(screen.getByLabelText("Token ID"), "42");
  await click("Add NFT");
  snapshot();
  if (kind === "adding")
    await act(async () => {
      await Promise.resolve();
      pending.resolve(undefined);
    });
  if (["enumerated", "manual", "1155", "adding"].includes(kind)) {
    await waitFor(() => {
      expect(mockClose).toHaveBeenCalledTimes(1);
    });
    expect(mockAdd).toHaveBeenCalled();
  }
});
it.each(["success", "reason", "non-error", "adding"])(
  "NFT picks %s",
  async (kind) => {
    mockStore.nftStore.pendingDiscoveredNftCollections = [1, 2].map(
      (count) => ({
        key: String(count),
        name: `Collection ${count}`,
        symbol: "EX",
        contractAddress: mockContract,
        tokenCount: count,
        tokens: [nft()],
        standard: "ERC1155",
        truncated: count > 1,
      }),
    );
    if (kind === "reason")
      mockPicks.mockRejectedValue(new Error("Storage detail 0xff"));
    if (kind === "non-error") mockPicks.mockRejectedValue(42);
    const pending = deferred<undefined>();
    if (kind === "adding") mockPicks.mockReturnValue(pending.promise);
    await show(<AddNftModal isOpen onClose={mockClose} />);
    snapshot();
    await act(async () => {
      await Promise.resolve();
      fireEvent.click(required(screen.getAllByRole("checkbox")[0]));
    });
    await click("Add Selected (1)");
    snapshot();
    if (kind === "adding")
      await act(async () => {
        await Promise.resolve();
        pending.resolve(undefined);
      });
  },
);

it("creation while unlocking", async () => {
  const pending = deferred<{ mnemonic: string }>();
  mockDecrypt.mockReturnValue(pending.promise);
  await creation();
  await pin();
  await submit();
  snapshot();
  await act(async () => {
    await Promise.resolve();
    pending.resolve({ mnemonic: "fixture" });
  });
});
it.each([
  "Wallet changed while preparing token creation",
  "The signing seed does not match the active account",
  "Factory contract address not configured. Please set VITE_CUSTOMERC20FACTORY_ADDRESS.",
  `Factory contract not deployed at address: ${mockContract}`,
  "TokenCreated event signature is not a 32-byte hash",
  "Transaction failed",
  "Token creation confirmation timed out.",
  "Token creation failed",
])("creation service %s", async (message) => {
  mockStore.tokenStore.creatingToken.error = message;
  await show(<TokenStatus />);
  snapshot();
});

it.each([
  "Testnet v3 network identity has not been verified",
  "Network changed during identity verification",
  "Account changed during identity verification",
  "Network identity is not configured",
  "Testnet v3 chain identity mismatch",
  "Testnet v3 genesis identity mismatch",
  "This account is signed by the paired mobile app. Confirm the transfer there.",
  "This account is signed by the extension wallet. Confirm the transfer there.",
  "The network fee quoted for this transaction is far above what this network normally charges, so the wallet stopped. Try again in a moment, and tell us if it keeps happening.",
  "Unknown error",
])("shared service %s", async (message) => {
  mockStore.tokenStore.creatingToken.error = message;
  await show(<TokenStatus />);
  snapshot();
});
