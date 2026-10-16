import { malformed } from "@/test-utils/malformed";
import { logger } from "@/utils/log";
import {
  detectTokenStandard,
  fetchErc1155Balance,
  fetchNftMetadata,
  fetchOwned721Ids,
  isTransientRpcError,
} from "../nft";

const mockSupports = jest.fn<Promise<unknown>, []>();
const mockBalance = jest.fn<Promise<unknown>, []>();
const mockTokenId = jest.fn<Promise<unknown>, []>();

jest.mock("@/config", () => ({ SERVER_URL: "https://wallet.example/api" }));
jest.mock("../web3Lazy", () => ({
  getQrlWeb3: () =>
    Promise.resolve({
      default: class {
        static providers: {
          HttpProvider: new (url: string) => { url: string };
        } = {
          HttpProvider: class {
            readonly url: string;
            constructor(url: string) {
              this.url = url;
            }
          },
        };
        qrl = {
          getCode: () => Promise.resolve("0x01"),
          Contract: class {
            methods = {
              supportsInterface: () => ({ call: mockSupports }),
              balanceOf: () => ({ call: mockBalance }),
              tokenOfOwnerByIndex: () => ({ call: mockTokenId }),
            };
          },
        };
        utils = { toChecksumAddress: (address: string) => address };
      },
    }),
}));

const CONTRACT = `Q${"1".repeat(128)}`;
const OWNER = `Q${"2".repeat(128)}`;
const RPC = "https://rpc.example";
const URI = "https://metadata.example/token";

function metadataResponse(body: unknown): void {
  jest
    .spyOn(globalThis, "fetch")
    .mockResolvedValue(
      malformed<Response>({ ok: true, json: () => Promise.resolve(body) }),
    );
}

beforeEach(() => {
  mockSupports.mockReset().mockResolvedValue(true);
  mockBalance.mockReset();
  mockTokenId.mockReset();
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("NFT RPC values", () => {
  it.each([1, "0x1", 1n, "false"])(
    "keeps Boolean coercion for interface support: %p",
    async (value) => {
      mockSupports.mockResolvedValue(value);
      await expect(detectTokenStandard(CONTRACT, RPC)).resolves.toBe("ERC721");
    },
  );

  it.each([0, "", 0n, null, undefined])(
    "keeps falsey interface responses: %p",
    async (value) => {
      mockSupports.mockResolvedValue(value);
      await expect(detectTokenStandard(CONTRACT, RPC)).resolves.toBeNull();
    },
  );

  it.each([7, 7n, "7", "0x7"])(
    "converts balances to bigint: %p",
    async (value) => {
      mockBalance.mockResolvedValue(value);
      await expect(
        fetchErc1155Balance(CONTRACT, OWNER, "42", RPC),
      ).resolves.toBe(7n);
    },
  );

  it("enumerates mixed numeric IDs in their original order", async () => {
    mockBalance.mockResolvedValue(3);
    mockTokenId
      .mockResolvedValueOnce(5)
      .mockResolvedValueOnce(7n)
      .mockResolvedValueOnce("0x2a");
    await expect(fetchOwned721Ids(CONTRACT, OWNER, RPC)).resolves.toEqual([
      "5",
      "7",
      "42",
    ]);
    expect(mockTokenId).toHaveBeenCalledTimes(3);
  });

  it("returns earlier IDs and logs the original failure when enumeration stops", async () => {
    const failure = new Error("execution reverted");
    const error = jest
      .spyOn(logger, "error")
      .mockImplementation(() => undefined);
    mockBalance.mockResolvedValue("3");
    mockTokenId.mockResolvedValueOnce("5").mockRejectedValueOnce(failure);
    await expect(fetchOwned721Ids(CONTRACT, OWNER, RPC)).resolves.toEqual([
      "5",
    ]);
    expect(error).toHaveBeenCalledWith(
      "tokenOfOwnerByIndex(1) failed:",
      failure,
    );
  });
});

describe("NFT metadata boundary", () => {
  it("preserves every attribute, including missing and extra fields", async () => {
    const attributes: unknown[] = [
      null,
      7,
      "blue",
      { trait_type: 4 },
      { value: false, extra: [1] },
    ];
    metadataResponse({
      name: "Item",
      image: "IPFS://cid/image",
      attributes,
      unused: true,
    });
    const result = await fetchNftMetadata(URI);
    expect(result).toEqual({
      name: "Item",
      image: "https://wallet.example/api/ipfs/cid/image",
      description: undefined,
      external_url: undefined,
      attributes,
    });
    expect(result?.attributes).toBe(attributes);
  });

  it.each([{}, [], "metadata", 42, false])(
    "keeps the empty metadata result for %p",
    async (body) => {
      metadataResponse(body);
      await expect(fetchNftMetadata(URI)).resolves.toEqual({
        name: undefined,
        description: undefined,
        image: undefined,
        external_url: undefined,
        attributes: undefined,
      });
    },
  );

  it("keeps existing field fallbacks and the image privacy rule", async () => {
    metadataResponse({
      name: 5,
      description: null,
      image: "https://tracker.example/image",
      external_url: false,
      attributes: {},
    });
    await expect(fetchNftMetadata(URI)).resolves.toEqual({
      name: undefined,
      description: undefined,
      image: undefined,
      external_url: undefined,
      attributes: undefined,
    });
  });

  it.each([null, undefined])(
    "retains the failed parse result for %p",
    async (body) => {
      metadataResponse(body);
      const error = jest
        .spyOn(logger, "error")
        .mockImplementation(() => undefined);
      await expect(fetchNftMetadata(URI)).resolves.toBeNull();
      expect(error).toHaveBeenCalledWith(
        "fetchNftMetadata failed:",
        expect.any(TypeError),
      );
    },
  );

  it("recognizes transport fields on arrays and non-plain objects", () => {
    expect(isTransientRpcError(Object.assign([], { code: "ETIMEDOUT" }))).toBe(
      true,
    );
    expect(
      isTransientRpcError(Object.assign(new Date(0), { status: 503 })),
    ).toBe(true);
  });
});
