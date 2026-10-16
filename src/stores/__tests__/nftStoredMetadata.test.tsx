/** @jest-environment jsdom */
import { arrayValue } from "@/utils/guards";
import { nftValue } from "@/constants/nft";
import { configure } from "mobx";
import { renderToStaticMarkup } from "react-dom/server";
import type { NFTInterface } from "@/constants";
import NftStore from "../nftStore";
import QrlStore from "../qrlStore";
import TokenStore from "../tokenStore";
import StorageUtil from "@/utils/storage/storage";
import { discoverNFTs } from "@/utils/web3/nftDiscovery";
import { fetchTokenUri } from "@/utils/web3/nft";
import { NftCard } from "@/components/Core/Body/Nfts/NftCard";
import { malformed } from "@/test-utils/malformed";
import { deferred } from "@/test-utils/deferred";

jest.mock("@/config", () => ({
  QRL_PROVIDER: { TEST_NET: { id: "TEST_NET", url: "https://rpc.invalid" } },
  getNFTDiscoveryApiUrl: () => "https://explorer.invalid/nfts",
}));
jest.mock("@/config/runtimeProfile", () => ({
  IS_V3_PROFILE: false,
  profileStorageKey: (key: string) => key,
  assertSupportedAccountSource: () => undefined,
}));
jest.mock("@/utils", () => ({
  ...jest.requireActual<typeof import("@/utils/cn")>("@/utils/cn"),
  log: jest.fn(),
}));
jest.mock("@/utils/log", () => ({
  logger: { log: jest.fn(), error: jest.fn() },
}));
jest.mock("@/utils/nativeApp", () => ({ isInNativeApp: () => false }));
jest.mock("@/utils/storage", () => ({
  StorageUtil: jest.requireActual<typeof import("@/utils/storage/storage")>(
    "@/utils/storage/storage",
  ).default,
}));
jest.mock("@/desktop/bridge", () => ({ isDesktop: false, desktopSigner: {} }));
jest.mock("@/utils/crypto", () => ({ deriveHexSeedAsync: jest.fn() }));
jest.mock("@/utils/nativeWalletMutation", () => ({ walletMutations: {} }));
jest.mock("@/utils/web3", () => ({
  getQrlWeb3: jest.fn(),
  discoverNFTs: jest.requireActual<typeof import("@/utils/web3/nftDiscovery")>(
    "@/utils/web3/nftDiscovery",
  ).discoverNFTs,
}));
jest.mock("@/utils/web3/nft", () => ({
  ...jest.requireActual<typeof import("@/utils/web3/nft")>("@/utils/web3/nft"),
  fetchTokenUri: jest.fn(() => Promise.resolve(null)),
  isErc721Owner: jest.fn(() => Promise.resolve(true)),
  fetchErc1155Balance: jest.fn(() => Promise.resolve(2n)),
}));
jest.mock("@/stores/store", () => ({
  useStore: () => ({ nftStore: { hideNft: jest.fn() } }),
}));
jest.mock("react-router", () => ({ useNavigate: () => jest.fn() }));
jest.mock("@/router/router", () => ({
  ROUTES: { NFT_DETAIL: "/nfts/:contractAddress/:tokenId" },
}));

const ACCOUNT_A = `Q${"12".repeat(64)}`;
const ACCOUNT_B = `Q${"34".repeat(64)}`;
const CONTRACT = `Q${"56".repeat(64)}`;
const nft = (tokenId: unknown): NFTInterface => ({
  contractAddress: CONTRACT,
  standard: "ERC1155",
  tokenId,
  name: "Collectible",
  balance: "2",
});
const storageKey = (account: string) =>
  `TEST_NET_${account.toLowerCase()}_NFT_LIST`;

function makeStore() {
  const qrlStore = new QrlStore();
  qrlStore.qrlConnection.blockchain = "TEST_NET";
  qrlStore.activeAccount.accountAddress = ACCOUNT_A;
  const store = new NftStore(qrlStore, new TokenStore(qrlStore));
  return { qrlStore, store };
}

beforeEach(() => {
  configure({ enforceActions: "never" });
  jest.useFakeTimers({ now: 1_000_000 });
  jest.clearAllMocks();
  localStorage.clear();
  jest
    .spyOn(QrlStore.prototype, "initializeBlockchain")
    .mockResolvedValue(undefined);
});

afterEach(() => {
  jest.clearAllTimers();
  jest.useRealTimers();
  jest.restoreAllMocks();
});

it.each([
  { fetchedAt: "1000000" },
  { fetchFailedAt: "900000", fetchRetryCount: "2" },
  { fetchedAt: [1000000], fetchRetryCount: [1] },
  { fetchedAt: {}, fetchFailedAt: {}, fetchRetryCount: {} },
])(
  "loads the selected account before adding with metadata %j",
  async (metadata) => {
    const balances = deferred<undefined>();
    jest
      .spyOn(NftStore.prototype, "refreshNftBalances")
      .mockReturnValue(balances.promise);
    const refreshMetadata = jest
      .spyOn(NftStore.prototype, "refreshNftMetadata")
      .mockResolvedValue(undefined);
    const first = [nft("1")];
    const second = [{ ...nft("2"), ...metadata }];
    await StorageUtil.updateNftList("TEST_NET", ACCOUNT_A, first);
    await StorageUtil.updateNftList("TEST_NET", ACCOUNT_B, second);
    const originalA = localStorage.getItem(storageKey(ACCOUNT_A));
    const { qrlStore, store } = makeStore();
    await store.initialize();
    qrlStore.activeAccount.accountAddress = ACCOUNT_B;
    await store.handleActiveAccountChanged(ACCOUNT_B);
    expect(store.nftList).toEqual(second);
    expect(refreshMetadata).not.toHaveBeenCalled();
    await store.addNft(nft("3"));
    expect(await StorageUtil.getNftList("TEST_NET", ACCOUNT_B)).toEqual([
      ...second,
      nft("3"),
    ]);
    expect(localStorage.getItem(storageKey(ACCOUNT_A))).toBe(originalA);
    balances.resolve(undefined);
    await balances.promise;
    expect(refreshMetadata).toHaveBeenCalledTimes(1);
  },
);

it.each([
  { tokenId: "legacy" },
  { contractAddress: null, tokenId: "legacy" },
  { contractAddress: 0, tokenId: "legacy" },
  { contractAddress: false, tokenId: "legacy" },
  { contractAddress: 1, tokenId: "legacy" },
  { contractAddress: [], tokenId: "legacy" },
  { contractAddress: {}, tokenId: "legacy" },
  null, false, 0, [], "legacy",
].map((sibling) => ({ sibling })))("loads account B's complete list before an add fails on sibling $sibling", async ({ sibling }) => {
  jest.spyOn(QrlStore.prototype, "fetchAccounts").mockResolvedValue(undefined);
  jest.spyOn(TokenStore.prototype, "refreshTokenBalances").mockResolvedValue(undefined);
  const first = [{ ...nft("1"), standard: "ERC721" }];
  const second = [{ ...nft("2"), standard: "ERC721" }, sibling];
  await StorageUtil.updateNftList("TEST_NET", ACCOUNT_A, first);
  await StorageUtil.updateNftList("TEST_NET", ACCOUNT_B, second);
  const originalA = localStorage.getItem(storageKey(ACCOUNT_A));
  const originalB = localStorage.getItem(storageKey(ACCOUNT_B));
  const { qrlStore, store } = makeStore();
  const tokens = new TokenStore(qrlStore);
  await store.initialize();
  qrlStore.onActiveAccountChanged = async (account) => {
    await tokens.handleActiveAccountChanged(account);
    await store.handleActiveAccountChanged(account);
  };

  await expect(qrlStore.setActiveAccount(ACCOUNT_B)).resolves.toBeUndefined();
  expect(qrlStore.activeAccount.accountAddress).toBe(ACCOUNT_B);
  expect(await StorageUtil.getActiveAccount("TEST_NET")).toBe(ACCOUNT_B);
  expect(store.nftList).toEqual(second);
  await expect(store.addNft(nft("3"))).rejects.toThrow(TypeError);
  expect(localStorage.getItem(storageKey(ACCOUNT_A))).toBe(originalA);
  expect(localStorage.getItem(storageKey(ACCOUNT_B))).toBe(originalB);
});

it("keeps timestamp coercion, retry backoff and string retry increments", async () => {
  const rows = [
    { ...nft("1"), fetchedAt: "1000000" },
    { ...nft("2"), fetchFailedAt: "999999", fetchRetryCount: "2" },
    { ...nft("3"), fetchRetryCount: "2" },
  ];
  await StorageUtil.updateNftList("TEST_NET", ACCOUNT_A, rows);
  const { store } = makeStore();
  await store.initialize();
  await store.refreshNftMetadata();
  expect(fetchTokenUri).toHaveBeenCalledTimes(1);
  expect(fetchTokenUri).toHaveBeenCalledWith(
    CONTRACT,
    "3",
    "https://rpc.invalid",
    "ERC1155",
  );
  expect(await StorageUtil.getNftList("TEST_NET", ACCOUNT_A)).toEqual([
    rows[0],
    rows[1],
    { ...rows[2], fetchRetryCount: "21", fetchFailedAt: 1_000_000 },
  ]);
});

it.each([
  { row: { tokenId: "legacy" }, address: undefined, tokenId: "legacy" },
  { row: { contractAddress: null, tokenId: "legacy" }, address: null, tokenId: "legacy" },
  { row: { contractAddress: 0, tokenId: "legacy" }, address: 0, tokenId: "legacy" },
  { row: false, address: undefined, tokenId: undefined },
])("keeps the metadata request before failure for $row", async ({ row, address, tokenId }) => {
  const requested = deferred<undefined>();
  const response = deferred<null>();
  jest.mocked(fetchTokenUri).mockImplementation(() => {
    requested.resolve(undefined);
    return response.promise;
  });
  await StorageUtil.updateNftList("TEST_NET", ACCOUNT_A, [row]);
  const original = localStorage.getItem(storageKey(ACCOUNT_A));
  const { store } = makeStore();
  await store.initialize();
  const refresh = store.refreshNftMetadata();
  await requested.promise;
  expect(fetchTokenUri).toHaveBeenCalledWith(address, tokenId, "https://rpc.invalid", undefined);
  expect(localStorage.getItem(storageKey(ACCOUNT_A))).toBe(original);
  response.resolve(null);
  await expect(refresh).rejects.toThrow(TypeError);
  expect(localStorage.getItem(storageKey(ACCOUNT_A))).toBe(original);
});

it("keeps a valid NFT in the discovery picker beside a malformed zero-ID row", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = jest.fn(() =>
    Promise.resolve(
      malformed<Response>({
        ok: true,
        json: () =>
          Promise.resolve({
            nfts: [
              {
                contractAddress: CONTRACT,
                tokenStandard: "ERC721",
                tokenID: "17",
                collectionName: "Known collection",
              },
              { contractAddress: 42, tokenStandard: "ERC721", tokenID: 0 },
            ],
          }),
      }),
    ),
  );
  try {
    const { store } = makeStore();
    await store.discoverNftsForReview(ACCOUNT_A);
    expect(store.pendingDiscoveredNfts).toEqual([
      {
        contractAddress: CONTRACT,
        standard: "ERC721",
        tokenId: "17",
        collectionName: "Known collection",
      },
    ]);
    expect(store.pendingDiscoveredNftCollections).toEqual([
      expect.objectContaining({ name: "Known collection", tokenCount: 1 }),
    ]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

it.each([
  { tokenID: ["7"], label: "#7" },
  {
    tokenID: Array.from({ length: 13 }, (_, index) => String(index)),
    label: "#0,1,2,3,4,5…9,10,11,12",
  },
  { tokenID: { length: "10" }, label: "#[object Object]" },
])(
  "renders a discovered and persisted token ID: $label",
  async ({ tokenID, label }) => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = jest.fn(() =>
      Promise.resolve(
        malformed<Response>({
          ok: true,
          json: () =>
            Promise.resolve({
              nfts: [
                {
                  contractAddress: CONTRACT,
                  tokenStandard: "ERC-1155",
                  tokenID,
                  name: "Collectible",
                  balance: "2",
                },
              ],
            }),
        }),
      ),
    );
    try {
      const found = await discoverNFTs(ACCOUNT_A, "TEST_NET");
      const { store } = makeStore();
      await store.initialize();
      await store.addDiscoveredNfts(found);
      const [raw] = arrayValue(await StorageUtil.getNftList("TEST_NET", ACCOUNT_A));
      const stored = nftValue(raw);
      expect(stored.tokenId).toEqual(tokenID);
      expect(renderToStaticMarkup(<NftCard nft={stored} />)).toContain(label);
    } finally {
      globalThis.fetch = originalFetch;
    }
  },
);

it("keeps boolean image names omitted from alt attributes and preserves balance errors", () => {
  for (const name of [true, false]) {
    const html = renderToStaticMarkup(
      <NftCard
        nft={{ ...nft("7"), name, image: "data:image/png;base64,eA==" }}
      />,
    );
    expect(html).not.toContain("alt=");
  }
  expect(() =>
    renderToStaticMarkup(<NftCard nft={{ ...nft("7"), balance: {} }} />),
  ).toThrow(SyntaxError);
});
