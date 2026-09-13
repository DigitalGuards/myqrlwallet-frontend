import {
  normalizeQrnsRecipientName,
  qrnsFunctionSelector,
  qrnsNamehashHex,
} from "@/utils/crypto/qrnsNamehash";
import { normalizeQrlAddress, QRL_ZERO_ADDRESS } from "@/utils/web3/address";

const ABI_WORD_HEX_LENGTH = 128;
const ADDRESS_HEX_LENGTH = 128;
const RPC_TIMEOUT_MS = 8_000;
const RESOLVER_SELECTOR = qrnsFunctionSelector("resolver(bytes32)");
const NATIVE_ADDRESS_SELECTOR = qrnsFunctionSelector("addr(bytes32)");

export interface QrnsRpcProvider {
  readonly identity: string;
  request(args: { method: string; params?: unknown[] }): Promise<unknown>;
}

export interface QrnsNetworkConfig {
  blockchain: string;
  networkName: string;
  rpcUrl: string;
  expectedChainId: string;
  registry: string;
}

export interface QrnsNetworkRecord {
  blockchain: string;
  networkName: string;
  rpcUrl: string;
  expectedChainId: string;
  registry: string;
}

export type QrnsNetworkConfiguration =
  | { available: true; config: QrnsNetworkConfig }
  | { available: false; reason: string };

export type QrnsUnavailableCode = "network-mismatch" | "registry-no-code";

export class QrnsUnavailableError extends Error {
  readonly code: QrnsUnavailableCode;

  constructor(code: QrnsUnavailableCode, message: string) {
    super(message);
    this.name = "QrnsUnavailableError";
    this.code = code;
  }
}

export class QrnsRpcError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "QrnsRpcError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** Normalize one JSON-RPC chain ID to canonical lowercase 0x hex. */
export function normalizeQrnsChainId(value: unknown): string | null {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]+$/.test(value)) {
    return null;
  }
  try {
    return `0x${BigInt(value).toString(16)}`;
  } catch {
    return null;
  }
}

/**
 * Validate the explicit QRNS deployment record for one selected network.
 * Empty and malformed records both leave name resolution unavailable.
 */
export function parseQrnsNetworkConfig(
  record: QrnsNetworkRecord | null,
): QrnsNetworkConfiguration {
  if (!record) {
    return {
      available: false,
      reason: "QRNS is unavailable until a wallet network is selected.",
    };
  }

  const expectedChainId = record.expectedChainId.trim();
  const registryInput = record.registry.trim();
  if (!expectedChainId && !registryInput) {
    return {
      available: false,
      reason: `QRNS is not configured for ${record.networkName}.`,
    };
  }

  const canonicalChainId = normalizeQrnsChainId(expectedChainId);
  const canonicalRegistry = normalizeQrlAddress(registryInput);
  const hasCanonicalChainId =
    canonicalChainId !== null && canonicalChainId === expectedChainId;
  const hasCanonicalRegistry =
    canonicalRegistry !== null &&
    canonicalRegistry === registryInput &&
    canonicalRegistry.toLowerCase() !== QRL_ZERO_ADDRESS.toLowerCase();

  if (
    !record.blockchain ||
    !record.networkName ||
    !record.rpcUrl.trim() ||
    !hasCanonicalChainId ||
    !hasCanonicalRegistry
  ) {
    return {
      available: false,
      reason: `QRNS configuration for ${record.networkName || "this network"} is incomplete or invalid.`,
    };
  }

  return {
    available: true,
    config: {
      blockchain: record.blockchain,
      networkName: record.networkName,
      rpcUrl: record.rpcUrl,
      expectedChainId: canonicalChainId,
      registry: canonicalRegistry,
    },
  };
}

/** Create a small JSON-RPC provider bound to the selected wallet RPC URL. */
export function createQrnsHttpProvider(
  rpcUrl: string,
  fetcher: typeof fetch = fetch,
): QrnsRpcProvider {
  let nextRequestId = 0;
  return {
    identity: `http:${rpcUrl}`,
    async request({ method, params = [] }): Promise<unknown> {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), RPC_TIMEOUT_MS);
      try {
        const response = await fetcher(rpcUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            jsonrpc: "2.0",
            id: ++nextRequestId,
            method,
            params,
          }),
          signal: controller.signal,
        });
        if (!response.ok) {
          throw new QrnsRpcError(`QRNS RPC returned HTTP ${response.status}`);
        }
        const body: unknown = await response.json();
        if (!isRecord(body)) {
          throw new QrnsRpcError("QRNS RPC returned an invalid response");
        }
        if (isRecord(body["error"])) {
          const message = body["error"]["message"];
          throw new QrnsRpcError(
            typeof message === "string" ? message : "QRNS RPC request failed",
          );
        }
        if (!("result" in body)) {
          throw new QrnsRpcError("QRNS RPC response has no result");
        }
        return body["result"];
      } catch (error) {
        if (error instanceof QrnsRpcError) throw error;
        if (error instanceof Error && error.name === "AbortError") {
          throw new QrnsRpcError("QRNS RPC request timed out");
        }
        throw new QrnsRpcError(
          error instanceof Error ? error.message : "QRNS RPC request failed",
        );
      } finally {
        clearTimeout(timeout);
      }
    },
  };
}

function bytes32Argument(node: string): string {
  if (!/^0x[0-9a-f]{64}$/.test(node)) {
    throw new Error("QRNS node must be 32-byte lowercase hex");
  }
  return `${node.slice(2)}${"0".repeat(64)}`;
}

function decodeNativeAddress(returnData: unknown): string | null {
  if (returnData === "0x") return null;
  if (
    typeof returnData !== "string" ||
    !new RegExp(`^0x[0-9a-fA-F]{${ADDRESS_HEX_LENGTH}}$`).test(returnData)
  ) {
    throw new QrnsRpcError("QRNS returned a malformed 64-byte address");
  }

  // qrl_call returns raw ABI bytes serialized as hex. Hex-letter casing on
  // that wire encoding has no checksum meaning, so normalize it before
  // deriving the public QIP-55 text form.
  const body = returnData.slice(2).toLowerCase();
  if (/^0+$/.test(body)) return null;
  const address = normalizeQrlAddress(`Q${body}`);
  if (!address || address.toLowerCase() === QRL_ZERO_ADDRESS.toLowerCase()) {
    throw new QrnsRpcError("QRNS returned an invalid QIP-55 address");
  }
  return address;
}

async function qrlCall(
  provider: QrnsRpcProvider,
  to: string,
  data: string,
): Promise<unknown> {
  return provider.request({
    method: "qrl_call",
    params: [{ to, data }, "latest"],
  });
}

/** Verify chain identity and deployed registry code before resolving a name. */
export async function verifyQrnsReadiness(
  config: QrnsNetworkConfig,
  provider: QrnsRpcProvider,
): Promise<void> {
  const chainId = normalizeQrnsChainId(
    await provider.request({ method: "qrl_chainId", params: [] }),
  );
  if (chainId !== config.expectedChainId) {
    throw new QrnsUnavailableError(
      "network-mismatch",
      `QRNS is unavailable because the RPC chain does not match ${config.networkName}.`,
    );
  }

  const code = await provider.request({
    method: "qrl_getCode",
    params: [config.registry, "latest"],
  });
  if (
    typeof code !== "string" ||
    !/^0x(?:[0-9a-fA-F]{2})*$/.test(code) ||
    /^0x0*$/.test(code)
  ) {
    throw new QrnsUnavailableError(
      "registry-no-code",
      `QRNS is unavailable because its registry is not deployed on ${config.networkName}.`,
    );
  }
}

/** Resolve one normalized QNS name through resolver(bytes32) and addr(bytes32). */
export async function resolveQrnsName(
  normalizedName: string,
  config: QrnsNetworkConfig,
  provider: QrnsRpcProvider,
): Promise<string | null> {
  const node = qrnsNamehashHex(normalizedName);
  const argument = bytes32Argument(node);
  if (argument.length !== ABI_WORD_HEX_LENGTH) {
    throw new Error("QRNS bytes32 argument has the wrong QRVM width");
  }

  const resolver = decodeNativeAddress(
    await qrlCall(provider, config.registry, `${RESOLVER_SELECTOR}${argument}`),
  );
  if (!resolver) return null;

  return decodeNativeAddress(
    await qrlCall(provider, resolver, `${NATIVE_ADDRESS_SELECTOR}${argument}`),
  );
}

/** Verify readiness and resolve one untrusted QNS name. */
export async function resolveQrnsRecipient(
  name: string,
  config: QrnsNetworkConfig,
  provider: QrnsRpcProvider,
): Promise<{ normalizedName: string; address: string | null }> {
  const normalizedName = normalizeQrnsRecipientName(name);
  await verifyQrnsReadiness(config, provider);
  const address = await resolveQrnsName(normalizedName, config, provider);
  return { normalizedName, address };
}
