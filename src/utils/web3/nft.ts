import type { default as Web3Type } from "@theqrl/web3";
import { getQrlWeb3 } from "./web3Lazy";
import { erc165ABI, ERC165_INTERFACE_IDS } from "@/abi/ERC165ABI";
import { erc721ABI } from "@/abi/ERC721ABI";
import { erc1155ABI } from "@/abi/ERC1155ABI";
import { SERVER_URL } from "@/config";

export type NftStandard = "ERC721" | "ERC1155";

export interface NftCollectionInfo {
  standard: NftStandard;
  name?: string;
  symbol?: string;
  supportsEnumerable: boolean;
}

export interface NftMetadata {
  name?: string;
  description?: string;
  image?: string;
  external_url?: string;
  attributes?: Array<{ trait_type?: string; value: string | number }>;
}

// IPFS gateway: route through the wallet's own backend (`/api/ipfs/:cid`)
// instead of a public gateway. Two reasons:
//   1. Same-origin satisfies the wallet's strict `img-src 'self'` CSP, so
//      `<img src={ipfsResolved}>` renders without allowlisting external
//      hosts.
//   2. Public gateways don't reliably set `Access-Control-Allow-Origin`,
//      so a direct browser `fetch()` of an `ipfs://...` metadata JSON
//      would frequently fail CORS. The proxy is same-origin, so CORS is
//      a non-issue.
// Trailing slash is required: callers concatenate the CID + optional path.
export const IPFS_GATEWAY = `${SERVER_URL}/ipfs/`;

const METADATA_FETCH_TIMEOUT_MS = 8000;

// Try ERC-165 supportsInterface(0x...). Returns false on any RPC revert
// (very common — pre-ERC-165 contracts revert instead of returning false).
async function safeSupportsInterface(
  web3: Web3Type,
  contractAddress: string,
  interfaceId: string,
): Promise<boolean> {
  try {
    const contract = new web3.qrl.Contract(erc165ABI as any, contractAddress);
    const result = await (contract.methods as any).supportsInterface(interfaceId).call();
    return Boolean(result);
  } catch {
    return false;
  }
}

/**
 * Detect whether an address is an ERC-721 or ERC-1155 contract, or
 * neither (returns null — caller falls through to ERC-20 / unsupported).
 */
export async function detectTokenStandard(
  contractAddress: string,
  rpcUrl: string,
): Promise<NftStandard | null> {
  const { default: Web3 } = await getQrlWeb3();
  const web3 = new Web3(new Web3.providers.HttpProvider(rpcUrl));

  // No code at address → not a contract.
  const code = await web3.qrl.getCode(contractAddress);
  if (!code || code === "0x" || code === "0x0") {
    return null;
  }

  if (await safeSupportsInterface(web3, contractAddress, ERC165_INTERFACE_IDS.ERC721)) {
    return "ERC721";
  }
  if (await safeSupportsInterface(web3, contractAddress, ERC165_INTERFACE_IDS.ERC1155)) {
    return "ERC1155";
  }
  return null;
}

export async function fetchNftCollectionInfo(
  contractAddress: string,
  rpcUrl: string,
  standard: NftStandard,
): Promise<NftCollectionInfo> {
  const { default: Web3 } = await getQrlWeb3();
  const web3 = new Web3(new Web3.providers.HttpProvider(rpcUrl));

  if (standard === "ERC721") {
    const contract = new web3.qrl.Contract(erc721ABI as any, contractAddress);
    const methods = contract.methods as any;
    let name: string | undefined;
    let symbol: string | undefined;
    try {
      name = (await methods.name().call()) as string;
    } catch {
      // Optional in ERC-721 — some implementations omit it.
    }
    try {
      symbol = (await methods.symbol().call()) as string;
    } catch {
      // Optional in ERC-721 — some implementations omit it.
    }
    const supportsEnumerable = await safeSupportsInterface(
      web3,
      contractAddress,
      ERC165_INTERFACE_IDS.ERC721_ENUMERABLE,
    );
    return { standard, name, symbol, supportsEnumerable };
  }

  // ERC-1155: no collection-level name/symbol on-chain.
  return { standard, supportsEnumerable: false };
}

/**
 * For ERC-721 contracts that implement Enumerable, list owned token IDs.
 * Returns null if the contract doesn't support Enumerable — callers
 * must then prompt the user for a tokenId.
 */
export async function fetchOwned721Ids(
  contractAddress: string,
  ownerAddress: string,
  rpcUrl: string,
): Promise<string[] | null> {
  const { default: Web3 } = await getQrlWeb3();
  const web3 = new Web3(new Web3.providers.HttpProvider(rpcUrl));
  const supportsEnumerable = await safeSupportsInterface(
    web3,
    contractAddress,
    ERC165_INTERFACE_IDS.ERC721_ENUMERABLE,
  );
  if (!supportsEnumerable) return null;

  const contract = new web3.qrl.Contract(erc721ABI as any, contractAddress);
  const methods = contract.methods as any;
  const checksum = web3.utils.toChecksumAddress(ownerAddress);
  const balanceRaw = (await methods.balanceOf(checksum).call()) as bigint | string;
  const balance = BigInt(balanceRaw);
  if (balance === 0n) return [];

  const ids: string[] = [];
  for (let i = 0n; i < balance; i++) {
    try {
      const id = (await methods
        .tokenOfOwnerByIndex(checksum, i)
        .call()) as bigint | string;
      ids.push(BigInt(id).toString());
    } catch (err) {
      console.error(`tokenOfOwnerByIndex(${i}) failed:`, err);
      break;
    }
  }
  return ids;
}

/** Confirm `owner` still holds an ERC-721 tokenId. */
export async function isErc721Owner(
  contractAddress: string,
  ownerAddress: string,
  tokenId: string,
  rpcUrl: string,
): Promise<boolean> {
  const { default: Web3 } = await getQrlWeb3();
  const web3 = new Web3(new Web3.providers.HttpProvider(rpcUrl));
  try {
    const contract = new web3.qrl.Contract(erc721ABI as any, contractAddress);
    const actual = (await (contract.methods as any).ownerOf(tokenId).call()) as string;
    return actual.toLowerCase() === web3.utils.toChecksumAddress(ownerAddress).toLowerCase();
  } catch {
    return false;
  }
}

/** Fetch ERC-1155 balance for (owner, id). */
export async function fetchErc1155Balance(
  contractAddress: string,
  ownerAddress: string,
  tokenId: string,
  rpcUrl: string,
): Promise<bigint> {
  const { default: Web3 } = await getQrlWeb3();
  const web3 = new Web3(new Web3.providers.HttpProvider(rpcUrl));
  const contract = new web3.qrl.Contract(erc1155ABI as any, contractAddress);
  const checksum = web3.utils.toChecksumAddress(ownerAddress);
  const raw = (await (contract.methods as any).balanceOf(checksum, tokenId).call()) as bigint | string;
  return BigInt(raw);
}

/**
 * Resolve the on-chain tokenURI (721) or uri (1155) for a token.
 * Per ERC-1155 spec the URI may contain a `{id}` placeholder that
 * clients substitute with the 64-char zero-padded hex token id.
 */
export async function fetchTokenUri(
  contractAddress: string,
  tokenId: string,
  rpcUrl: string,
  standard: NftStandard,
): Promise<string | null> {
  const { default: Web3 } = await getQrlWeb3();
  const web3 = new Web3(new Web3.providers.HttpProvider(rpcUrl));
  try {
    if (standard === "ERC721") {
      const contract = new web3.qrl.Contract(erc721ABI as any, contractAddress);
      const uri = (await (contract.methods as any).tokenURI(tokenId).call()) as string;
      return uri || null;
    }
    const contract = new web3.qrl.Contract(erc1155ABI as any, contractAddress);
    let uri = (await (contract.methods as any).uri(tokenId).call()) as string;
    if (uri && uri.includes("{id}")) {
      const hexId = BigInt(tokenId).toString(16).padStart(64, "0");
      uri = uri.replace(/\{id\}/g, hexId);
    }
    return uri || null;
  } catch (err) {
    console.error("Failed to fetch tokenURI:", err);
    return null;
  }
}

/** Rewrite `ipfs://CID/path` → public gateway URL.
 * Scheme match is case-insensitive (RFC 3986 §3.1) so `IPFS://...` and
 * mixed-case variants from older metadata producers also resolve. */
export function resolveIpfsUri(uri: string): string {
  const lower = uri.toLowerCase();
  if (lower.startsWith("ipfs://ipfs/")) {
    return `${IPFS_GATEWAY}${uri.slice("ipfs://ipfs/".length)}`;
  }
  if (lower.startsWith("ipfs://")) {
    return `${IPFS_GATEWAY}${uri.slice("ipfs://".length)}`;
  }
  return uri;
}

/**
 * Fetch + parse NFT JSON metadata. Returns null on any failure (timeout,
 * 404, JSON parse error). Sanitizes the `image` field to proxied IPFS
 * (same-origin via `/api/ipfs/...`) or inline `data:image/...` only.
 * Raw http(s):// image URLs are dropped on purpose — tokenURI content
 * is attacker-controlled and would otherwise leak the wallet user's IP
 * to any host the JSON points at.
 */
export async function fetchNftMetadata(uri: string): Promise<NftMetadata | null> {
  const resolved = resolveIpfsUri(uri);

  // Only allow http(s) for the metadata document itself. data: URIs are
  // valid in spec but rare and add a parser surface we don't need yet.
  if (!resolved.startsWith("http://") && !resolved.startsWith("https://")) {
    return null;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), METADATA_FETCH_TIMEOUT_MS);

  try {
    const res = await fetch(resolved, { signal: controller.signal });
    if (!res.ok) return null;
    const json = (await res.json()) as Partial<NftMetadata> & Record<string, unknown>;

    let image = typeof json.image === "string" ? json.image : undefined;
    if (image) {
      const rawImage = image;
      const resolvedImage = resolveIpfsUri(image);
      // Only allow images that are either (a) proxied IPFS — `ipfs://`
      // resolves to same-origin `/api/ipfs/...` so the browser fetches
      // through the wallet backend and CSP `img-src 'self'` permits it,
      // or (b) inline `data:image/...`. Reject raw http(s):// images:
      // attacker-controlled tokenURI JSON could otherwise point `image`
      // at a tracker host and leak the user's IP + a per-wallet
      // correlation token on render. Widening `img-src` to `https:` to
      // accommodate that case was the original cause of the leak.
      const rawLower = rawImage.toLowerCase();
      const isProxiedIpfs =
        rawLower.startsWith("ipfs://") &&
        resolvedImage.startsWith(IPFS_GATEWAY);
      const isInlineImage = rawLower.startsWith("data:image/");
      image = isProxiedIpfs || isInlineImage ? resolvedImage : undefined;
    }

    return {
      name: typeof json.name === "string" ? json.name : undefined,
      description:
        typeof json.description === "string" ? json.description : undefined,
      image,
      external_url:
        typeof json.external_url === "string" ? json.external_url : undefined,
      attributes: Array.isArray(json.attributes)
        ? (json.attributes as NftMetadata["attributes"])
        : undefined,
    };
  } catch (err) {
    console.error("fetchNftMetadata failed:", err);
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Composite key for an NFT (contract + tokenId). Used as the persistence
 * key in `hiddenNfts` and as the React list key in the gallery.
 */
export function nftKey(contractAddress: string, tokenId: string): string {
  return `${contractAddress.toLowerCase()}:${tokenId}`;
}
