export interface NetworkConfig {
  id: string;
  url: string;
  name: string;
  explorer: string;
  expectedChainId?: string;
  genesisHash?: string;
  qrns: { expectedChainId: string; registry: string };
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

export function v3Deployment(env: Record<string, unknown>) {
  const expectedChainId = canonicalChainId(env["VITE_V3_CHAIN_ID"]);
  const genesisHash = env["VITE_V3_GENESIS_HASH"];
  if (!expectedChainId)
    throw new Error("VITE_V3_CHAIN_ID is required for the v3 profile");
  if (
    typeof genesisHash !== "string" ||
    !/^0x[0-9a-fA-F]{64}$/.test(genesisHash)
  )
    throw new Error("VITE_V3_GENESIS_HASH must be a 32-byte hash");
  const network: NetworkConfig = {
    id: "TEST_NET_V3",
    name: "QRL Testnet v3 (Private)",
    url: requiredUrl(env, "VITE_V3_RPC_URL"),
    explorer: requiredUrl(env, "VITE_V3_EXPLORER_URL"),
    expectedChainId,
    genesisHash: genesisHash.toLowerCase(),
    qrns: { expectedChainId: "", registry: "" },
  };
  return { network, serverUrl: requiredUrl(env, "VITE_V3_SERVER_URL") };
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
            () => reject(new Error("Network identity verification timed out")),
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
    throw new Error("Testnet v3 chain identity mismatch");
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
    throw new Error("Testnet v3 genesis identity mismatch");
}
