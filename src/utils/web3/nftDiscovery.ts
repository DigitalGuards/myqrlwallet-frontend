import { getNFTDiscoveryApiUrl } from "@/config";
import { NFTInterface } from "@/constants";
import { log } from "@/utils";

// One row of the zondscan /api/address/:addr/nfts response. Shape mirrors
// backendAPI/models/token_balance.go:NFTBalance, restricted to the
// fields the wallet actually consumes. NFTInterface has no slot for
// externalURL / attributes today, so they're dropped on the wire.
interface ExplorerNFT {
  contractAddress: string;
  holderAddress: string;
  tokenID: string;
  tokenStandard: "ERC-721" | "ERC-1155" | string;
  balance?: string;
  blockNumber?: string;
  updatedAt?: string;
  collectionName?: string;
  collectionSymbol?: string;
  name?: string;
  description?: string;
  image?: string;
}

interface ExplorerNFTResponse {
  address: string;
  nfts: ExplorerNFT[];
  count: number;
}

// The wallet stores NftStandard as "ERC721" / "ERC1155" (no hyphen);
// the explorer returns "ERC-721" / "ERC-1155". Normalise on the wire.
function normaliseStandard(s: string): "ERC721" | "ERC1155" | null {
  if (s === "ERC-721" || s === "ERC721") return "ERC721";
  if (s === "ERC-1155" || s === "ERC1155") return "ERC1155";
  return null;
}

/**
 * Discovers NFTs held by an address using the explorer's
 * /address/:addr/nfts endpoint. The endpoint joins both the
 * collection-level row (collectionName, collectionSymbol) and the
 * per-token metadata row (name, image, description, attributes) so a
 * single call has enough to render a picker with thumbnails.
 *
 * Returns an empty list on any error or non-2xx so a flaky explorer
 * call can't crash the wallet UI.
 */
export async function discoverNFTs(
  address: string,
  blockchain: string,
): Promise<NFTInterface[]> {
  try {
    const apiUrl = getNFTDiscoveryApiUrl(address, blockchain);
    log(`Discovering NFTs for ${address} from ${apiUrl}`);

    const response = await fetch(apiUrl);
    if (!response.ok) {
      if (response.status === 404) {
        log(`No NFTs found for ${address}`);
        return [];
      }
      throw new Error(`NFT discovery failed: ${response.statusText}`);
    }

    const data: ExplorerNFTResponse = await response.json();
    if (!data || !Array.isArray(data.nfts)) {
      log("Invalid NFT discovery response format");
      return [];
    }

    const fetchedAt = Date.now();
    const out: NFTInterface[] = [];
    for (const n of data.nfts) {
      const std = normaliseStandard(n.tokenStandard);
      if (!std) continue;
      if (!n.contractAddress || !n.tokenID) continue;
      out.push({
        contractAddress: n.contractAddress.startsWith("Q")
          ? n.contractAddress
          : n.contractAddress.startsWith("q")
            ? `Q${n.contractAddress.slice(1)}`
            : `Q${n.contractAddress.replace(/^0x/i, "")}`,
        standard: std,
        tokenId: n.tokenID,
        collectionName: n.collectionName || undefined,
        collectionSymbol: n.collectionSymbol || undefined,
        name: n.name || undefined,
        description: n.description || undefined,
        image: n.image || undefined,
        balance: n.balance || undefined,
        fetchedAt,
      });
    }

    log(`Discovered ${out.length} NFTs for ${address}`);
    return out;
  } catch (error) {
    console.error("Error discovering NFTs:", error);
    log(`NFT discovery error: ${error}`);
    return [];
  }
}
