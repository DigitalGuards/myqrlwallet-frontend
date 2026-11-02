export interface NetworkConfig {
  id: string;
  url: string;
  name: string;
  explorer: string;
  expectedChainId?: string;
  genesisHash?: string;
  qrns: { expectedChainId: string; registry: string };
  /**
   * QRC20 factory on this network; empty keeps token creation off. Only the
   * v3 networks carry one. The legacy networks use the build-wide factory.
   */
  tokenFactory?: string;
}

/** The v3 testnet: the network every existing v3 install is on. */
export const TESTNET_V3_ID = "TEST_NET_V3";
/** QRL 2.0 mainnet. A build carries it only when both identity pins are set. */
export const MAINNET_V3_ID = "MAIN_NET_V3";
/** Every network id the v3 profile can hold, configured or not. */
export const V3_NETWORK_IDS: readonly string[] = [TESTNET_V3_ID, MAINNET_V3_ID];
export const MAINNET_DEFAULT_RPC_URL =
  "https://qrlwallet.com/api/qrl-rpc/mainnet";

const GENESIS_HASH_PATTERN = /^0x[0-9a-fA-F]{64}$/;

/** The native capability `networkProfile` a v3 network is advertised under. */
export function nativeNetworkProfile(id: string): "v3-private" | "v3-mainnet" {
  return id === MAINNET_V3_ID ? "v3-mainnet" : "v3-private";
}

/**
 * True only for the mainnet entry with both identity pins. The wallet shows
 * fiat values on this network alone, once its identity has been verified.
 */
export function isPinnedMainnet(
  network: Pick<NetworkConfig, "id" | "expectedChainId" | "genesisHash"> | undefined,
): boolean {
  return (
    network?.id === MAINNET_V3_ID &&
    !!network.expectedChainId &&
    !!network.genesisHash
  );
}

export function canonicalChainId(value: unknown): string | null {
  if (typeof value !== "string" || !/^(?:0x[0-9a-fA-F]+|[0-9]+)$/.test(value))
    return null;
  try {
    const chain = BigInt(value);
    return chain > 0n && chain < 1n << 256n ? `0x${chain.toString(16)}` : null;
  } catch {
    return null;
  }
}

function requiredUrl(env: Record<string, unknown>, key: string): string {
  const value = env[key];
  if (typeof value !== "string" || value.trim() !== value || !value)
    throw new Error(`${key} is required for the v3 profile`);
  const url = new URL(value);
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (
    (url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) ||
    url.username ||
    url.password ||
    url.hash ||
    url.search
  ) {
    throw new Error(
      `${key} must be a credential-free HTTPS URL (HTTP is allowed only on loopback)`,
    );
  }
  return value.replace(/\/$/, "");
}

const isUnset = (value: unknown): boolean => value === undefined || value === "";

function optionalUrl(
  env: Record<string, unknown>,
  key: string,
  fallback: string,
): string {
  return isUnset(env[key]) ? fallback : requiredUrl(env, key);
}

function optionalContract(env: Record<string, unknown>, key: string): string {
  const value = env[key];
  if (value === undefined || value === "") return "";
  if (
    typeof value !== "string" ||
    !/^Q[0-9a-fA-F]{128}$/.test(value) ||
    /^Q0+$/.test(value)
  ) {
    throw new Error(`${key} must be a nonzero 64-byte QRL address`);
  }
  return value;
}

export function v3Deployment(env: Record<string, unknown>) {
  const expectedChainId = canonicalChainId(env["VITE_V3_CHAIN_ID"]);
  const genesisHash = env["VITE_V3_GENESIS_HASH"];
  if (!expectedChainId)
    throw new Error("VITE_V3_CHAIN_ID is required for the v3 profile");
  if (typeof genesisHash !== "string" || !GENESIS_HASH_PATTERN.test(genesisHash))
    throw new Error("VITE_V3_GENESIS_HASH must be a 32-byte hash");
  const registry = optionalContract(env, "VITE_V3_QNS_REGISTRY");
  const tokenFactory = optionalContract(env, "VITE_V3_FACTORY_ADDRESS");
  const explorerUrl = requiredUrl(env, "VITE_V3_EXPLORER_URL");
  const serverUrl = requiredUrl(env, "VITE_V3_SERVER_URL");
  const network: NetworkConfig = {
    id: TESTNET_V3_ID,
    name: "QRL Testnet v3 (Private)",
    url: requiredUrl(env, "VITE_V3_RPC_URL"),
    explorer: explorerUrl,
    expectedChainId,
    genesisHash: genesisHash.toLowerCase(),
    qrns: { expectedChainId: registry ? expectedChainId : "", registry },
    tokenFactory,
  };
  return { network, serverUrl, tokenFactory };
}

export type V3Deployment = ReturnType<typeof v3Deployment>;

/**
 * The optional QRL 2.0 mainnet block. It stays dormant (null) until BOTH
 * VITE_MAINNET_CHAIN_ID and VITE_MAINNET_GENESIS_HASH are set. One pin
 * without the other, or a pin equal to the testnet one, fails the build.
 */
export function v3MainnetDeployment(
  env: Record<string, unknown>,
  testnet: V3Deployment,
): V3Deployment | null {
  const rawChainId = env["VITE_MAINNET_CHAIN_ID"];
  const genesisHash = env["VITE_MAINNET_GENESIS_HASH"];
  if (isUnset(rawChainId) && isUnset(genesisHash)) return null;
  if (isUnset(rawChainId) || isUnset(genesisHash))
    throw new Error(
      "VITE_MAINNET_CHAIN_ID and VITE_MAINNET_GENESIS_HASH must be set together",
    );
  const expectedChainId = canonicalChainId(rawChainId);
  if (!expectedChainId)
    throw new Error("VITE_MAINNET_CHAIN_ID must be a positive chain id");
  if (typeof genesisHash !== "string" || !GENESIS_HASH_PATTERN.test(genesisHash))
    throw new Error("VITE_MAINNET_GENESIS_HASH must be a 32-byte hash");
  if (expectedChainId === testnet.network.expectedChainId)
    throw new Error("VITE_MAINNET_CHAIN_ID must differ from the testnet chain id");
  if (genesisHash.toLowerCase() === testnet.network.genesisHash)
    throw new Error(
      "VITE_MAINNET_GENESIS_HASH must differ from the testnet genesis hash",
    );
  const url = optionalUrl(env, "VITE_MAINNET_RPC_URL", MAINNET_DEFAULT_RPC_URL);
  if (url === testnet.network.url)
    throw new Error("VITE_MAINNET_RPC_URL must differ from VITE_V3_RPC_URL");
  const registry = optionalContract(env, "VITE_MAINNET_QNS_REGISTRY");
  const tokenFactory = optionalContract(env, "VITE_MAINNET_FACTORY_ADDRESS");
  const serverUrl = optionalUrl(
    env,
    "VITE_MAINNET_SERVER_URL",
    testnet.serverUrl,
  );
  const network: NetworkConfig = {
    id: MAINNET_V3_ID,
    name: "QRL 2.0 Mainnet",
    url,
    // Empty means no explorer links, no explorer discovery and no price.
    explorer: optionalUrl(env, "VITE_MAINNET_EXPLORER_URL", ""),
    expectedChainId,
    genesisHash: genesisHash.toLowerCase(),
    qrns: { expectedChainId: registry ? expectedChainId : "", registry },
    tokenFactory,
  };
  return { network, serverUrl, tokenFactory };
}

function networkChoice(
  env: Record<string, unknown>,
  key: string,
  mainnet: V3Deployment | null,
): string {
  const value = env[key];
  if (isUnset(value) || value === "testnet") return TESTNET_V3_ID;
  if (value !== "mainnet") throw new Error(`${key} must be testnet or mainnet`);
  if (!mainnet)
    throw new Error(
      `${key}=mainnet requires VITE_MAINNET_CHAIN_ID and VITE_MAINNET_GENESIS_HASH`,
    );
  return MAINNET_V3_ID;
}

/**
 * The whole v3 network profile of one build.
 *
 * A native build (the desktop renderer or the app-embedded document) lists
 * exactly one network, VITE_V3_NATIVE_NETWORK, and starts on it. A web build
 * lists the testnet plus the mainnet when it is pinned, and starts on
 * VITE_DEFAULT_NETWORK. One wallet API serves every network a build lists
 * (history requests name their network), so a web build that lists both
 * needs one server URL for both.
 */
export function v3Profile(env: Record<string, unknown>, nativeBuild: boolean) {
  const testnet = v3Deployment(env);
  const mainnet = v3MainnetDeployment(env, testnet);
  const nativeNetworkId = networkChoice(env, "VITE_V3_NATIVE_NETWORK", mainnet);
  const defaultNetworkId = networkChoice(env, "VITE_DEFAULT_NETWORK", mainnet);
  if (nativeBuild && !isUnset(env["VITE_DEFAULT_NETWORK"]) && defaultNetworkId !== nativeNetworkId)
    throw new Error(
      "VITE_DEFAULT_NETWORK must match VITE_V3_NATIVE_NETWORK in a native build",
    );
  if (!nativeBuild && mainnet && mainnet.serverUrl !== testnet.serverUrl)
    throw new Error(
      "VITE_MAINNET_SERVER_URL must match VITE_V3_SERVER_URL in a build that lists both networks",
    );
  const deployments = mainnet ? [testnet, mainnet] : [testnet];
  const available = nativeBuild
    ? deployments.filter(({ network }) => network.id === nativeNetworkId)
    : deployments;
  const initialNetworkId = nativeBuild ? nativeNetworkId : defaultNetworkId;
  const initial =
    available.find(({ network }) => network.id === initialNetworkId) ?? testnet;
  const native = nativeNetworkId === MAINNET_V3_ID && mainnet ? mainnet : testnet;
  return {
    testnet,
    mainnet,
    available: available.map(({ network }) => network),
    initial,
    nativeNetwork: native.network,
  };
}

export async function verifyNetworkIdentity(
  provider: {
    request(args: { method: string; params: unknown[] }): Promise<unknown>;
  },
  network: Pick<NetworkConfig, "expectedChainId" | "genesisHash">,
): Promise<void> {
  if (!network.expectedChainId || !network.genesisHash)
    throw new Error("Network identity is not configured");
  const request = async (method: string, params: unknown[]) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        provider.request({ method, params }),
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => {
              reject(new Error("Network identity verification timed out"));
            },
            10000,
          );
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  };
  const chain = await request("qrl_chainId", []);
  if (canonicalChainId(chain) !== network.expectedChainId)
    throw new Error("Network chain identity mismatch");
  const block = await request("qrl_getBlockByNumber", ["0x0", false]);
  if (
    typeof block !== "object" ||
    block === null ||
    !("hash" in block) ||
    !("number" in block) ||
    block.number !== "0x0" ||
    typeof block.hash !== "string" ||
    block.hash.toLowerCase() !== network.genesisHash
  )
    throw new Error("Network genesis identity mismatch");
}
