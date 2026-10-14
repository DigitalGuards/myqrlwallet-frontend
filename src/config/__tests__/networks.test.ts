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

describe.each(["", "v3-private"])(
  "network lookup with profile %s",
  (profile) => {
    let networks: Record<string, unknown>;

    beforeAll(() => {
      const code = execFileSync(
        process.execPath,
        ["--input-type=module", "--eval", buildScript],
        {
          cwd: resolve(__dirname, "../../.."),
          env: {
            ...process.env,
            NODE_ENV: "production",
            VITE_SEED: "",
            VITE_WALLET_PROFILE: profile,
            VITE_EXPLORER_URL_PRODUCTION: "https://legacy-explorer.example",
            VITE_V3_CHAIN_ID: "3151909",
            VITE_V3_GENESIS_HASH: `0x${"ab".repeat(32)}`,
            VITE_V3_RPC_URL: "https://wallet.example/rpc",
            VITE_V3_SERVER_URL: "https://wallet.example/api",
            VITE_V3_EXPLORER_URL: "https://v3-explorer.example",
            VITE_V3_QNS_REGISTRY: "",
            VITE_V3_FACTORY_ADDRESS: "",
          },
          encoding: "utf8",
          timeout: 30_000,
        },
      );
      const loaded: unknown = runInNewContext(`${code}\nnetworks;`, { URL });
      if (!isRecord(loaded))
        throw new Error("Invalid network configuration exports");
      networks = loaded;
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
          expect(exportedFunction(networks, helper)("value", blockchain)).toBe(
            `${explorer}${suffix}`,
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
