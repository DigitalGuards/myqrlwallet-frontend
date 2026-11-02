import {
  canonicalChainId,
  isPinnedMainnet,
  nativeNetworkProfile,
  v3Deployment,
  v3MainnetDeployment,
  v3Profile,
  verifyNetworkIdentity,
} from "../deploymentProfile";

const HASH = `0x${"ab".repeat(32)}`;
const ENV = {
  VITE_V3_RPC_URL: "https://dev.example/api/qrl-rpc/testnet",
  VITE_V3_SERVER_URL: "https://dev.example/api",
  VITE_V3_EXPLORER_URL: "https://explorer.example",
  VITE_V3_CHAIN_ID: "3151909",
  VITE_V3_GENESIS_HASH: HASH,
};

it.each([
  ["https://zondscan.com", "https://zondscan.com"],
  ["https://custom.example/v3/", "https://custom.example/v3"],
  ["http://127.0.0.1:3000/explorer/", "http://127.0.0.1:3000/explorer"],
])("keeps the configured explorer endpoint: %s", (input, expected) => {
  const result = v3Deployment({ ...ENV, VITE_V3_EXPLORER_URL: input });
  expect(result.network.explorer).toBe(expected);
  expect(result.network.url).toBe(ENV.VITE_V3_RPC_URL);
  expect(result.serverUrl).toBe(ENV.VITE_V3_SERVER_URL);
  expect(result.network.genesisHash).toBe(HASH);
});

it.each([
  "http://zondscan.com",
  "https://user:password@zondscan.com",
  "https://zondscan.com/?token=secret",
  "https://zondscan.com/#fragment",
  " https://zondscan.com",
  "https://zondscan.com ",
])("rejects an invalid explorer URL: %s", (url) => {
  expect(() => v3Deployment({ ...ENV, VITE_V3_EXPLORER_URL: url })).toThrow();
});

it("requires explicit v3 endpoints and produces an independent identity with disabled contracts", () => {
  const result = v3Deployment(ENV);
  expect(result.network).toMatchObject({
    id: "TEST_NET_V3",
    name: "QRL Testnet v3 (Private)",
    url: ENV.VITE_V3_RPC_URL,
    expectedChainId: `0x${(3151909).toString(16)}`,
    genesisHash: HASH,
    qrns: { expectedChainId: "", registry: "" },
  });
  expect(result.tokenFactory).toBe("");
});

it("enables each explicitly configured v3 deployment on its pinned chain", () => {
  const registry = `Q${"1".repeat(128)}`;
  const factory = `Q${"2".repeat(128)}`;
  const result = v3Deployment({
    ...ENV,
    VITE_V3_QNS_REGISTRY: registry,
    VITE_V3_FACTORY_ADDRESS: factory,
  });
  expect(result.network.qrns).toEqual({
    expectedChainId: "0x301825",
    registry,
  });
  expect(result.tokenFactory).toBe(factory);
});

it("keeps historical deployments isolated from the v3 profile", () => {
  const result = v3Deployment({
    ...ENV,
    VITE_QRNS_CHAIN_ID_TEST_NET: "0x539",
    VITE_QRNS_REGISTRY_TEST_NET: `Q${"1".repeat(128)}`,
    VITE_CUSTOMERC20FACTORY_ADDRESS: `Q${"2".repeat(128)}`,
  });
  expect(result.network.qrns).toEqual({ expectedChainId: "", registry: "" });
  expect(result.tokenFactory).toBe("");
});

describe.each(["VITE_V3_QNS_REGISTRY", "VITE_V3_FACTORY_ADDRESS"])(
  "%s",
  (key) => {
    it.each([
      null,
      1,
      `Q${"1".repeat(40)}`,
      `0x${"1".repeat(128)}`,
      `q${"1".repeat(128)}`,
      `Q${"0".repeat(128)}`,
      ` Q${"1".repeat(128)}`,
      `Q${"1".repeat(128)} `,
    ])("rejects malformed deployment %p", (address) => {
      expect(() => v3Deployment({ ...ENV, [key]: address })).toThrow(key);
    });
  },
);

it.each(Object.keys(ENV))("fails closed when %s is absent", (key) => {
  expect(() => v3Deployment({ ...ENV, [key]: "" })).toThrow();
});

it.each([
  "http://remote.example",
  "https://user:password@remote.example",
  "https://remote.example/?token=secret",
  "https://remote.example/#fragment",
])("rejects unsafe browser endpoint %s", (url) => {
  expect(() => v3Deployment({ ...ENV, VITE_V3_RPC_URL: url })).toThrow();
});

it("permits an explicitly configured loopback fixture", () => {
  expect(
    v3Deployment({ ...ENV, VITE_V3_RPC_URL: "http://127.0.0.1:18545" }).network
      .url,
  ).toBe("http://127.0.0.1:18545");
});

it.each(["", "0", "0x0", "-1", "1.0", "garbage", "0x", `0x1${"0".repeat(64)}`])(
  "rejects invalid chain identity %s",
  (chain) => {
    expect(canonicalChainId(chain)).toBeNull();
  },
);

it("verifies chain and genesis through only the expected read methods", async () => {
  const provider = {
    request: jest
      .fn()
      .mockResolvedValueOnce("0x301825")
      .mockResolvedValueOnce({ number: "0x0", hash: HASH }),
  };
  await verifyNetworkIdentity(provider, {
    expectedChainId: "0x301825",
    genesisHash: HASH,
  });
  expect(provider.request.mock.calls).toEqual([
    [{ method: "qrl_chainId", params: [] }],
    [{ method: "qrl_getBlockByNumber", params: ["0x0", false] }],
  ]);
});

it.each([
  { chain: "0x539", block: { number: "0x0", hash: HASH } },
  { chain: "0x301825", block: { number: "0x0", hash: `0x${"cd".repeat(32)}` } },
  { chain: "0x301825", block: { number: "0x1", hash: HASH } },
  { chain: "0x301825", block: null },
])(
  "rejects a mismatched or incomplete identity: %p",
  async ({ chain, block }) => {
    const provider = {
      request: jest
        .fn()
        .mockResolvedValueOnce(chain)
        .mockResolvedValueOnce(block),
    };
    await expect(
      verifyNetworkIdentity(provider, {
        expectedChainId: "0x301825",
        genesisHash: HASH,
      }),
    ).rejects.toThrow(/identity mismatch/);
  },
);

it("bounds a stalled identity lookup without leaking its timer", async () => {
  jest.useFakeTimers();
  const pending = verifyNetworkIdentity(
    { request: () => new Promise(() => undefined) },
    { expectedChainId: "0x301825", genesisHash: HASH },
  );
  const rejected = expect(pending).rejects.toThrow("timed out");
  await jest.advanceTimersByTimeAsync(10000);
  await rejected;
  expect(jest.getTimerCount()).toBe(0);
  jest.useRealTimers();
});

describe("dormant mainnet block", () => {
  const MAINNET_HASH = `0x${"CD".repeat(32)}`;
  const PINS = {
    VITE_MAINNET_CHAIN_ID: "1",
    VITE_MAINNET_GENESIS_HASH: MAINNET_HASH,
  };
  const testnet = () => v3Deployment(ENV);

  it.each([{}, { VITE_MAINNET_CHAIN_ID: "", VITE_MAINNET_GENESIS_HASH: "" }])(
    "stays dormant without both pins: %p",
    (pins) => {
      expect(v3MainnetDeployment({ ...ENV, ...pins }, testnet())).toBeNull();
      const profile = v3Profile({ ...ENV, ...pins }, false);
      expect(profile.mainnet).toBeNull();
      expect(profile.available.map(({ id }) => id)).toEqual(["TEST_NET_V3"]);
      expect(profile.initial.network.id).toBe("TEST_NET_V3");
      expect(profile.nativeNetwork.id).toBe("TEST_NET_V3");
    },
  );

  it("pins a mainnet that differs from the testnet, with every optional feature off", () => {
    const mainnet = v3MainnetDeployment({ ...ENV, ...PINS }, testnet());
    expect(mainnet).toEqual({
      network: {
        id: "MAIN_NET_V3",
        name: "QRL 2.0 Mainnet",
        url: "https://qrlwallet.com/api/qrl-rpc/mainnet",
        explorer: "",
        expectedChainId: "0x1",
        genesisHash: MAINNET_HASH.toLowerCase(),
        qrns: { expectedChainId: "", registry: "" },
        tokenFactory: "",
      },
      serverUrl: ENV.VITE_V3_SERVER_URL,
      tokenFactory: "",
    });
    expect(isPinnedMainnet(mainnet?.network)).toBe(true);
    expect(isPinnedMainnet(testnet().network)).toBe(false);
    expect(
      isPinnedMainnet({ id: "MAIN_NET_V3", expectedChainId: "", genesisHash: "" }),
    ).toBe(false);
  });

  it("scopes explorer, factory and QNS to the mainnet entry", () => {
    const registry = `Q${"5".repeat(128)}`;
    const factory = `Q${"6".repeat(128)}`;
    const mainnet = v3MainnetDeployment(
      {
        ...ENV,
        ...PINS,
        VITE_MAINNET_RPC_URL: "https://rpc.example/mainnet",
        VITE_MAINNET_EXPLORER_URL: "https://mainnet-explorer.example/",
        VITE_MAINNET_QNS_REGISTRY: registry,
        VITE_MAINNET_FACTORY_ADDRESS: factory,
        // Testnet deployments never leak into the mainnet entry.
        VITE_V3_QNS_REGISTRY: `Q${"1".repeat(128)}`,
        VITE_V3_FACTORY_ADDRESS: `Q${"2".repeat(128)}`,
      },
      testnet(),
    );
    expect(mainnet?.network).toMatchObject({
      url: "https://rpc.example/mainnet",
      explorer: "https://mainnet-explorer.example",
      qrns: { expectedChainId: "0x1", registry },
      tokenFactory: factory,
    });
    expect(mainnet?.tokenFactory).toBe(factory);
  });

  it.each([
    [{ VITE_MAINNET_CHAIN_ID: "1" }, "must be set together"],
    [{ VITE_MAINNET_GENESIS_HASH: MAINNET_HASH }, "must be set together"],
    [{ ...PINS, VITE_MAINNET_CHAIN_ID: "3151909" }, "must differ from the testnet chain id"],
    [{ ...PINS, VITE_MAINNET_CHAIN_ID: "0x301825" }, "must differ from the testnet chain id"],
    [{ ...PINS, VITE_MAINNET_GENESIS_HASH: HASH.toUpperCase().replace("0X", "0x") }, "must differ from the testnet genesis hash"],
    [{ ...PINS, VITE_MAINNET_CHAIN_ID: "0" }, "VITE_MAINNET_CHAIN_ID"],
    [{ ...PINS, VITE_MAINNET_CHAIN_ID: " 1" }, "VITE_MAINNET_CHAIN_ID"],
    [{ ...PINS, VITE_MAINNET_GENESIS_HASH: "0x1234" }, "VITE_MAINNET_GENESIS_HASH"],
    [{ ...PINS, VITE_MAINNET_RPC_URL: ENV.VITE_V3_RPC_URL }, "must differ from VITE_V3_RPC_URL"],
    [{ ...PINS, VITE_MAINNET_RPC_URL: "http://remote.example" }, "VITE_MAINNET_RPC_URL"],
    [{ ...PINS, VITE_MAINNET_EXPLORER_URL: "https://x.example/?k=v" }, "VITE_MAINNET_EXPLORER_URL"],
    [{ ...PINS, VITE_MAINNET_FACTORY_ADDRESS: `Q${"0".repeat(128)}` }, "VITE_MAINNET_FACTORY_ADDRESS"],
  ])("fails the profile parse for %p", (env, message) => {
    expect(() => v3Profile({ ...ENV, ...env }, false)).toThrow(message);
  });

  it.each([
    [{ VITE_V3_NATIVE_NETWORK: "mainnet" }, "VITE_V3_NATIVE_NETWORK=mainnet requires"],
    [{ VITE_DEFAULT_NETWORK: "mainnet" }, "VITE_DEFAULT_NETWORK=mainnet requires"],
    [{ VITE_V3_NATIVE_NETWORK: "Mainnet" }, "must be testnet or mainnet"],
    [{ VITE_DEFAULT_NETWORK: "main" }, "must be testnet or mainnet"],
  ])("refuses a mainnet choice the build cannot honour: %p", (env, message) => {
    expect(() => v3Profile({ ...ENV, ...env }, false)).toThrow(message);
    expect(() => v3Profile({ ...ENV, ...env }, true)).toThrow(message);
  });

  it("lists both networks on the web and starts on the configured default", () => {
    const web = v3Profile({ ...ENV, ...PINS }, false);
    expect(web.available.map(({ id }) => id)).toEqual(["TEST_NET_V3", "MAIN_NET_V3"]);
    expect(web.initial.network.id).toBe("TEST_NET_V3");
    const mainnetFirst = v3Profile({ ...ENV, ...PINS, VITE_DEFAULT_NETWORK: "mainnet" }, false);
    expect(mainnetFirst.initial.network.id).toBe("MAIN_NET_V3");
  });

  it("needs one wallet API for a web build that lists both networks", () => {
    expect(() =>
      v3Profile({ ...ENV, ...PINS, VITE_MAINNET_SERVER_URL: "https://other.example/api" }, false),
    ).toThrow("VITE_MAINNET_SERVER_URL must match VITE_V3_SERVER_URL");
    const native = v3Profile(
      {
        ...ENV,
        ...PINS,
        VITE_V3_NATIVE_NETWORK: "mainnet",
        VITE_MAINNET_SERVER_URL: "https://other.example/api",
      },
      true,
    );
    expect(native.initial.serverUrl).toBe("https://other.example/api");
  });

  it.each([
    [{}, "TEST_NET_V3", "v3-private"],
    [{ VITE_V3_NATIVE_NETWORK: "testnet" }, "TEST_NET_V3", "v3-private"],
    [{ VITE_V3_NATIVE_NETWORK: "mainnet" }, "MAIN_NET_V3", "v3-mainnet"],
  ])("gives a native build exactly its own network: %p", (env, id, capability) => {
    const native = v3Profile({ ...ENV, ...PINS, ...env }, true);
    expect(native.available.map((network) => network.id)).toEqual([id]);
    expect(native.initial.network.id).toBe(id);
    expect(native.nativeNetwork.id).toBe(id);
    expect(nativeNetworkProfile(native.nativeNetwork.id)).toBe(capability);
  });

  it("refuses a native build whose default names another network", () => {
    expect(() =>
      v3Profile({ ...ENV, ...PINS, VITE_DEFAULT_NETWORK: "mainnet" }, true),
    ).toThrow("must match VITE_V3_NATIVE_NETWORK");
  });
});
