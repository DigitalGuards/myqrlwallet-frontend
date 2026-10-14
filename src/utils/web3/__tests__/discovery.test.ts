import { malformed } from "@/test-utils/malformed";
import { logger } from "@/utils/log";
import { log } from "@/utils";
import { discoverNFTs } from "../nftDiscovery";
import { discoverTokens, mergeTokenLists } from "../tokenDiscovery";

jest.mock("@/config", () => ({
  getNFTDiscoveryApiUrl: () => "https://explorer.example/nfts",
  getTokenDiscoveryApiUrl: () => "https://explorer.example/tokens",
}));
jest.mock("@/utils", () => ({ log: jest.fn() }));

const OWNER = `Q${"1".repeat(128)}`;
const HEX = "2".repeat(128);
const ADDRESS = `Q${HEX}`;

function response(body: unknown): void {
  jest
    .spyOn(globalThis, "fetch")
    .mockResolvedValue(
      malformed<Response>({ ok: true, json: () => Promise.resolve(body) }),
    );
}

beforeEach(() => {
  jest.spyOn(Date, "now").mockReturnValue(1234);
});
afterEach(() => {
  jest.restoreAllMocks();
});

describe("explorer token discovery", () => {
  it.each([12345, 12345n, "12345", "0x3039"])(
    "retains numeric balances and zero decimals: %p",
    async (balance) => {
      response({
        tokens: [
          { contractAddress: `0x${HEX}`, balance, decimals: 0, extra: true },
        ],
      });
      await expect(discoverTokens(OWNER, "TEST_NET")).resolves.toEqual([
        {
          address: ADDRESS,
          name: "Unknown Token",
          symbol: "UNK",
          decimals: 0,
          amount: "12,345.0",
        },
      ]);
    },
  );

  it("keeps missing and null decimals on the existing default path", async () => {
    response({
      tokens: [
        { contractAddress: ADDRESS, balance: "1000000000000000000" },
        {
          contractAddress: `q${HEX}`,
          balance: 0,
          decimals: null,
          name: null,
          symbol: "",
        },
      ],
    });
    await expect(discoverTokens(OWNER, "TEST_NET")).resolves.toEqual([
      {
        address: ADDRESS,
        name: "Unknown Token",
        symbol: "UNK",
        decimals: 18,
        amount: "1.0",
      },
      {
        address: ADDRESS,
        name: "Unknown Token",
        symbol: "UNK",
        decimals: 18,
        amount: "0.0",
      },
    ]);
  });

  it("retains each row and its metadata when balance formatting fails", async () => {
    response({
      tokens: [
        {
          contractAddress: ADDRESS,
          balance: "broken",
          name: "First",
          symbol: "ONE",
          decimals: 2,
        },
        {
          contractAddress: ADDRESS,
          balance: "100",
          name: "Second",
          symbol: "TWO",
          decimals: 2,
        },
      ],
    });
    const tokens = await discoverTokens(OWNER, "TEST_NET");
    expect(tokens.map((token) => [token.name, token.amount])).toEqual([
      ["First", "0.0"],
      ["Second", "1.0"],
    ]);
    expect(mergeTokenLists([], tokens)).toEqual(tokens);
    expect(
      mergeTokenLists(
        [
          {
            address: ADDRESS,
            name: "Existing",
            symbol: "OLD",
            decimals: 2,
            amount: "4.0",
          },
        ],
        tokens,
      ),
    ).toEqual([
      {
        address: ADDRESS,
        name: "Existing",
        symbol: "OLD",
        decimals: 2,
        amount: "4.0",
      },
    ]);
  });

  it("copies truthy metadata and decimals verbatim", async () => {
    const name = { localized: "Token" };
    const symbol = ["T"];
    response({
      tokens: [
        {
          contractAddress: ADDRESS,
          name,
          symbol,
          decimals: "0x2",
          balance: 123,
        },
      ],
    });
    await expect(discoverTokens(OWNER, "TEST_NET")).resolves.toEqual([
      {
        address: ADDRESS,
        name,
        symbol,
        decimals: "0x2",
        amount: "1.23",
      },
    ]);
  });
});

describe("explorer NFT discovery", () => {
  it("keeps balances, IDs, metadata, duplicates, and discovery order", async () => {
    const name = { localized: "NFT" };
    response({
      nfts: [
        {
          contractAddress: `q${HEX}`,
          tokenStandard: "ERC-1155",
          tokenID: 7,
          balance: 12,
          name,
        },
        {
          contractAddress: ADDRESS,
          tokenStandard: "ERC721",
          tokenID: "7",
          balance: 0,
          description: null,
        },
        {
          contractAddress: `0x${HEX}`,
          tokenStandard: "ERC1155",
          tokenID: "7",
          balance: "0x8",
          extra: true,
        },
      ],
    });
    await expect(discoverNFTs(OWNER, "TEST_NET")).resolves.toEqual([
      {
        contractAddress: ADDRESS,
        standard: "ERC1155",
        tokenId: 7,
        name,
        balance: 12,
        fetchedAt: 1234,
      },
      { contractAddress: ADDRESS, standard: "ERC721", tokenId: "7" },
      {
        contractAddress: ADDRESS,
        standard: "ERC1155",
        tokenId: "7",
        balance: "0x8",
      },
    ]);
  });

  it("keeps the existing standard, address, and token-ID checks", async () => {
    response({
      nfts: [
        { contractAddress: ADDRESS, tokenStandard: "ERC20", tokenID: "7" },
        { tokenStandard: "ERC721", tokenID: "7" },
        { contractAddress: ADDRESS, tokenStandard: "ERC721", tokenID: 0 },
        {
          contractAddress: ADDRESS,
          tokenStandard: "ERC721",
          tokenID: "0",
          image: "ipfs://image",
        },
      ],
    });
    await expect(discoverNFTs(OWNER, "TEST_NET")).resolves.toEqual([
      {
        contractAddress: ADDRESS,
        standard: "ERC721",
        tokenId: "0",
        image: "ipfs://image",
        fetchedAt: 1234,
      },
    ]);
  });
});

const discoveryCases: [
  string,
  (address: string, blockchain: string) => Promise<unknown[]>,
][] = [
  ["NFT", discoverNFTs],
  ["Token", discoverTokens],
];

describe.each(discoveryCases)("%s discovery failures", (label, discover) => {
  it.each([null, {}, { tokens: null, nfts: false }])(
    "keeps the invalid response fallback for %p",
    async (body) => {
      response(body);
      await expect(discover(OWNER, "TEST_NET")).resolves.toEqual([]);
    },
  );

  it("preserves the interpolation failure for a symbol rejection", async () => {
    const failure = Symbol("failed");
    jest.spyOn(globalThis, "fetch").mockRejectedValue(failure);
    const error = jest
      .spyOn(logger, "error")
      .mockImplementation(() => undefined);
    await expect(discover(OWNER, "TEST_NET")).rejects.toThrow(
      "Cannot convert a Symbol value to a string",
    );
    expect(error).toHaveBeenCalledWith(
      label === "NFT" ? "Error discovering NFTs:" : "Error discovering tokens:",
      failure,
    );
  });

  it.each([null, undefined, 7, 9n])(
    "keeps error arguments and interpolation for %p",
    async (failure) => {
      jest.spyOn(globalThis, "fetch").mockRejectedValue(failure);
      const error = jest
        .spyOn(logger, "error")
        .mockImplementation(() => undefined);
      await expect(discover(OWNER, "TEST_NET")).resolves.toEqual([]);
      expect(error).toHaveBeenCalledWith(
        label === "NFT"
          ? "Error discovering NFTs:"
          : "Error discovering tokens:",
        failure,
      );
      expect(log).toHaveBeenLastCalledWith(
        `${label} discovery error: ${String(failure)}`,
      );
    },
  );
});
