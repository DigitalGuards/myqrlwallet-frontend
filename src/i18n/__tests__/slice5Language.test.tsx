/** @jest-environment jsdom */
// Live language regression fixtures use synthetic, non-signing data.
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
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
import { applyLanguage, i18n } from "../index";
import { assetMessage, assetServiceError } from "../assetMessage";

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
afterEach(async () => {
  cleanup();
  jest.restoreAllMocks();
  await applyLanguage("en");
});
async function show(element: ReactElement) {
  await act(async () => {
    await Promise.resolve();
    render(<HelmetProvider>{element}</HelmetProvider>);
  });
}
async function change(element: HTMLElement, value: string) {
  await act(async () => {
    await Promise.resolve();
    fireEvent.change(element, { target: { value } });
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

it.each(["de", "es", "ru", "zh-CN"] as const)(
  "%s keeps creation validation live without resetting fields",
  async (language) => {
    await creation();
    await change(screen.getByPlaceholderText("Example: MyQRLWallet"), "");
    await submit();
    expect(screen.getByText("Token name is required")).toBeDefined();
    await act(async () => {
      await Promise.resolve();
      await applyLanguage(language);
    });
    expect(screen.getByText(i18n.t("creation:nameRequired"))).toBeDefined();
    expect(
      document.querySelector<HTMLInputElement>('[name="tokenSymbol"]')?.value,
    ).toBe("EX");
    expect(mockStore.tokenStore.createToken).not.toHaveBeenCalled();
    expect(mockDecrypt).not.toHaveBeenCalled();
  },
);
it.each(["de", "es", "ru", "zh-CN"] as const)(
  "%s keeps transfer validation, recipient and metadata live",
  async (language) => {
    await show(<NftDetail />);
    await change(
      screen.getByLabelText("Recipient address or QNS name"),
      mockTo,
    );
    await change(screen.getByLabelText("Amount"), "8");
    await submit();
    await act(async () => {
      await Promise.resolve();
      await applyLanguage(language);
    });
    expect(
      screen.getByText(i18n.t("nfts:insufficient", { balance: "7" })),
    ).toBeDefined();
    expect(document.querySelector<HTMLInputElement>("#nft-to")?.value).toBe(
      mockTo,
    );
    expect(document.querySelector<HTMLInputElement>("#nft-amount")?.value).toBe(
      "8",
    );
    expect(screen.getByText("Metadata <b>stays</b> verbatim")).toBeDefined();
    expect(screen.getByText("Untranslated NFT")).toBeDefined();
    expect(screen.getByText("Collection example (EX)")).toBeDefined();
    expect(mockTransfer).not.toHaveBeenCalled();
    expect(mockDecrypt).not.toHaveBeenCalled();
  },
);
it.each(["de", "es", "ru", "zh-CN"] as const)(
  "%s keeps PIN failure live without another unlock",
  async (language) => {
    mockDecrypt.mockRejectedValue(
      new PinVerificationError({
        isLocked: false,
        remainingMs: 0,
        attemptsLeft: 2,
      }),
    );
    await show(<NftDetail />);
    await pin();
    await submit();
    expect(mockDecrypt).toHaveBeenCalledTimes(1);
    await act(async () => {
      await Promise.resolve();
      await applyLanguage(language);
    });
    expect(
      screen.getByText(i18n.t("settings:incorrectPin", { count: 2 })),
    ).toBeDefined();
    expect(mockDecrypt).toHaveBeenCalledTimes(1);
    expect(mockTransfer).not.toHaveBeenCalled();
  },
);
it.each(["de", "es", "ru", "zh-CN"] as const)(
  "%s keeps import details verbatim without another detection",
  async (language) => {
    mockDetect.mockRejectedValue(
      new Error("External <b>nfts:wrongOwner</b> 0xff"),
    );
    await show(<AddNftModal isOpen onClose={mockClose} />);
    await change(screen.getByLabelText("Contract Address"), mockContract);
    expect(mockDetect).toHaveBeenCalledTimes(1);
    await act(async () => {
      await Promise.resolve();
      await applyLanguage(language);
    });
    expect(screen.getByRole("alert").textContent).toBe(
      i18n.t("nfts:detectionReason", {
        reason: "External <b>nfts:wrongOwner</b> 0xff",
      }),
    );
    expect(screen.getByRole("alert").querySelector("b")).toBeNull();
    expect(mockDetect).toHaveBeenCalledTimes(1);
  },
);
it.each(["en", "de", "es", "ru", "zh-CN"] as const)(
  "%s preserves all external service details and hash/address bytes",
  async (language) => {
    await applyLanguage(language);
    const t = i18n.getFixedT(null, [
      "creation",
      "nfts",
      "tokens",
      "home",
      "transfer",
      "settings",
      "onboarding",
      "common",
    ] as const);
    for (const detail of [
      "nfts:wrongOwner",
      "{{amount}}",
      "RPC error 0xff <script>",
      "",
      "Signer rejected Q123",
      "constructor",
      "toString",
      "__proto__",
    ]) {
      expect(assetMessage({ external: detail }, t)).toBe(detail);
      expect(
        assetMessage({ key: "nfts:addReason", reason: detail }, t),
      ).toContain(detail);
      expect(
        assetMessage(assetServiceError(`NFT transfer failed: ${detail}`), t),
      ).toBe(t("nfts:serviceReason", { reason: detail }));
    }
    mockStore.tokenStore.createdToken.address = mockContract;
    await show(<TokenStatus />);
    const links = [...document.querySelectorAll("a")].map(
      (element) => element.href,
    );
    expect(links).toContain(`https://explorer.example/tx/${HASH}`);
    expect(links).toContain("https://explorer.example/block/42");
    for (const button of document.querySelectorAll("button"))
      if (!button.textContent)
        await act(async () => {
          await Promise.resolve();
          fireEvent.click(button);
        });
    expect(mockCopy).toHaveBeenCalledWith(mockContract);
    expect(mockCopy).toHaveBeenCalledWith(HASH);
  },
);
it("uses Russian collection cardinal forms", async () => {
  await applyLanguage("ru");
  expect([1, 2, 5, 21].map((count) => i18n.t("nfts:items", { count }))).toEqual(
    ["1 объект", "2 объекта", "5 объектов", "21 объект"],
  );
});
