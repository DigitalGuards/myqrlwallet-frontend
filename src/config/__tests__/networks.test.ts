import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";
import { isCallable, isRecord } from "@/utils/guards";

// Vite supplies import.meta.env and the profile constants for the real module.
// The bundle stays in memory and its configuration makes no network requests.
const buildScript = String.raw`
  import { build } from 'vite';
  const result = await build({
    configFile: 'config/vite.config.ts',
    mode: 'production',
    logLevel: 'silent',
    plugins: [{
      name: 'network-test-single-chunk',
      configResolved(config) {
        delete config.build.rolldownOptions.output.manualChunks;
      },
    }],
    build: {
      write: false,
      copyPublicDir: false,
      lib: { entry: 'src/config/networks.ts', name: 'networks', formats: ['iife'] },
    },
  });
  const builds = Array.isArray(result) ? result : [result];
  const chunk = builds.flatMap((item) => item.output).find((item) => item.type === 'chunk');
  if (!chunk) throw new Error('Missing network configuration bundle');
  process.stdout.write(chunk.code);
`;

const urlHelpers: ReadonlyArray<readonly [string, string]> = [
  ["getExplorerAddressUrl", "/address/value"],
  ["getExplorerTxUrl", "/tx/value"],
  ["getTokenDiscoveryApiUrl", "/api/address/value/tokens?standard=ERC-20"],
  ["getNFTDiscoveryApiUrl", "/api/address/value/nfts"],
];

function exportedFunction(module: Record<string, unknown>, name: string) {
  const value = module[name];
  if (!isCallable(value)) throw new Error(`Missing network helper: ${name}`);
  return value;
}

const TESTNET_GENESIS = `0x${"ab".repeat(32)}`;
const MAINNET_GENESIS = `0x${"cd".repeat(32)}`;
const MAINNET_PINS = {
  VITE_MAINNET_CHAIN_ID: "1",
  VITE_MAINNET_GENESIS_HASH: MAINNET_GENESIS,
};
// Every key this suite may set, cleared first so the caller's shell cannot
// leak a value into a build.
const BASE_ENV: Record<string, string> = {
  NODE_ENV: "production",
  VITE_SEED: "",
  VITE_DESKTOP: "",
  VITE_WALLET_PROFILE: "",
  VITE_EXPLORER_URL_PRODUCTION: "https://legacy-explorer.example",
  VITE_V3_CHAIN_ID: "3151909",
  VITE_V3_GENESIS_HASH: TESTNET_GENESIS,
  VITE_V3_RPC_URL: "https://wallet.example/rpc",
  VITE_V3_SERVER_URL: "https://wallet.example/api",
  VITE_V3_EXPLORER_URL: "https://v3-explorer.example",
  VITE_V3_QNS_REGISTRY: "",
  VITE_V3_FACTORY_ADDRESS: "",
  VITE_V3_NATIVE_NETWORK: "",
  VITE_DEFAULT_NETWORK: "",
  VITE_MAINNET_CHAIN_ID: "",
  VITE_MAINNET_GENESIS_HASH: "",
  VITE_MAINNET_RPC_URL: "",
  VITE_MAINNET_SERVER_URL: "",
  VITE_MAINNET_EXPLORER_URL: "",
  VITE_MAINNET_QNS_REGISTRY: "",
  VITE_MAINNET_FACTORY_ADDRESS: "",
};

/** Build the real networks.ts with Vite under `env` and load its exports. */
function buildNetworks(env: Record<string, string>): Record<string, unknown> {
  const code = execFileSync(
    process.execPath,
    ["--input-type=module", "--eval", buildScript],
    {
      cwd: resolve(__dirname, "../../.."),
      env: { ...process.env, ...BASE_ENV, ...env },
      encoding: "utf8",
      timeout: 30_000,
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  const loaded: unknown = runInNewContext(`${code}\nnetworks;`, { URL });
  if (!isRecord(loaded))
    throw new Error("Invalid network configuration exports");
  return loaded;
}

function networkIds(networks: Record<string, unknown>): unknown[] {
  const available = networks["AVAILABLE_NETWORKS"];
  if (!Array.isArray(available)) throw new Error("Missing network list");
  return available.map((network: unknown) =>
    isRecord(network) ? network["id"] : undefined,
  );
}

function provider(networks: Record<string, unknown>, id: string) {
  const providers = networks["QRL_PROVIDER"];
  if (!isRecord(providers)) throw new Error("Missing configured networks");
  const network = providers[id];
  if (!isRecord(network)) throw new Error(`Missing network ${id}`);
  return network;
}

describe.each(["", "v3-private"])(
  "network lookup with profile %s",
  (profile) => {
    let networks: Record<string, unknown>;

    beforeAll(() => {
      networks = buildNetworks({ VITE_WALLET_PROFILE: profile });
    }, 35_000);

    it.each(["TEST_NET", "MAIN_NET", "TEST_NET_V3"])(
      "preserves the configured provider and URLs for %s",
      (blockchain) => {
        const providers = networks["QRL_PROVIDER"];
        if (!isRecord(providers))
          throw new Error("Missing configured networks");
        expect(exportedFunction(networks, "getNetworkConfig")(blockchain)).toBe(
          providers[blockchain],
        );
        const explorer = profile
          ? "https://v3-explorer.example"
          : blockchain === "TEST_NET_V3"
            ? ""
            : "https://legacy-explorer.example";
        for (const [helper, suffix] of urlHelpers) {
          // A network without an explorer gets no URL at all.
          expect(exportedFunction(networks, helper)("value", blockchain)).toBe(
            explorer ? `${explorer}${suffix}` : "",
          );
        }
      },
    );

    it.each(["", "UNKNOWN", "constructor", "__proto__", "toString"])(
      "fails closed for unknown network %s",
      (blockchain) => {
        expect(
          exportedFunction(networks, "getNetworkConfig")(blockchain),
        ).toBeUndefined();
        for (const [helper] of urlHelpers) {
          expect(() =>
            exportedFunction(networks, helper)("value", blockchain),
          ).toThrow("Unknown wallet network");
        }
      },
    );
  },
);

describe("dormant mainnet", () => {
  it("keeps a v3 build without mainnet pins on the testnet alone", () => {
    const networks = buildNetworks({ VITE_WALLET_PROFILE: "v3-private" });
    expect(networkIds(networks)).toEqual(["TEST_NET_V3"]);
    expect(networks["DEFAULT_NETWORK_ID"]).toBe("TEST_NET_V3");
    // The entry exists only as an inert placeholder: no endpoint, no identity.
    expect(provider(networks, "MAIN_NET_V3")).toMatchObject({
      url: "",
      explorer: "",
      expectedChainId: "",
      genesisHash: "",
      tokenFactory: "",
    });
    expect(exportedFunction(networks, "isAvailableNetwork")("MAIN_NET_V3")).toBe(
      false,
    );
    expect(exportedFunction(networks, "isAvailableNetwork")("MAIN_NET")).toBe(
      false,
    );
  }, 35_000);

  it("lists a pinned mainnet beside the testnet on the web, never the legacy MAIN_NET", () => {
    const networks = buildNetworks({
      VITE_WALLET_PROFILE: "v3-private",
      ...MAINNET_PINS,
    });
    expect(networkIds(networks)).toEqual(["TEST_NET_V3", "MAIN_NET_V3"]);
    expect(networks["DEFAULT_NETWORK_ID"]).toBe("TEST_NET_V3");
    expect(networks["SERVER_URL"]).toBe("https://wallet.example/api");
    expect(provider(networks, "MAIN_NET_V3")).toEqual({
      id: "MAIN_NET_V3",
      name: "QRL 2.0 Mainnet",
      url: "https://qrlwallet.com/api/qrl-rpc/mainnet",
      explorer: "",
      expectedChainId: "0x1",
      genesisHash: MAINNET_GENESIS,
      qrns: { expectedChainId: "", registry: "" },
      tokenFactory: "",
    });
    // The testnet entry is unchanged by the mainnet block.
    expect(provider(networks, "TEST_NET_V3")).toMatchObject({
      url: "https://wallet.example/rpc",
      explorer: "https://v3-explorer.example",
      expectedChainId: "0x301825",
      genesisHash: TESTNET_GENESIS,
    });
    for (const [helper] of urlHelpers) {
      expect(exportedFunction(networks, helper)("value", "MAIN_NET_V3")).toBe("");
    }
  }, 35_000);

  it("starts on the pinned mainnet when VITE_DEFAULT_NETWORK asks for it", () => {
    const networks = buildNetworks({
      VITE_WALLET_PROFILE: "v3-private",
      VITE_DEFAULT_NETWORK: "mainnet",
      VITE_MAINNET_EXPLORER_URL: "https://mainnet-explorer.example",
      ...MAINNET_PINS,
    });
    expect(networkIds(networks)).toEqual(["TEST_NET_V3", "MAIN_NET_V3"]);
    expect(networks["DEFAULT_NETWORK_ID"]).toBe("MAIN_NET_V3");
    expect(networks["EXPLORER_BASE"]).toBe("https://mainnet-explorer.example");
    expect(
      exportedFunction(networks, "getExplorerTxUrl")("0xabc", "MAIN_NET_V3"),
    ).toBe("https://mainnet-explorer.example/tx/0xabc");
  }, 35_000);

  it.each([
    ["testnet", {}, "TEST_NET_V3"],
    ["testnet", { VITE_V3_NATIVE_NETWORK: "testnet" }, "TEST_NET_V3"],
    ["mainnet", { VITE_V3_NATIVE_NETWORK: "mainnet" }, "MAIN_NET_V3"],
  ])(
    "lists only the native %s network in a desktop build",
    (_label, env, id) => {
      const networks = buildNetworks({
        VITE_WALLET_PROFILE: "v3-private",
        VITE_DESKTOP: "1",
        ...MAINNET_PINS,
        ...env,
      });
      expect(networkIds(networks)).toEqual([id]);
      expect(networks["DEFAULT_NETWORK_ID"]).toBe(id);
    },
    35_000,
  );

  it.each([
    ["only a chain id", { VITE_MAINNET_CHAIN_ID: "1" }],
    ["only a genesis hash", { VITE_MAINNET_GENESIS_HASH: MAINNET_GENESIS }],
    [
      "the testnet chain id",
      { ...MAINNET_PINS, VITE_MAINNET_CHAIN_ID: "0x301825" },
    ],
    [
      "the testnet genesis hash",
      { ...MAINNET_PINS, VITE_MAINNET_GENESIS_HASH: TESTNET_GENESIS },
    ],
    ["a native mainnet without pins", { VITE_V3_NATIVE_NETWORK: "mainnet" }],
    ["a default mainnet without pins", { VITE_DEFAULT_NETWORK: "mainnet" }],
  ])("fails the build for %s", (_label, env) => {
    expect(() =>
      buildNetworks({ VITE_WALLET_PROFILE: "v3-private", ...env }),
    ).toThrow(/VITE_MAINNET|VITE_V3_NATIVE_NETWORK|VITE_DEFAULT_NETWORK/);
  }, 35_000);
});
