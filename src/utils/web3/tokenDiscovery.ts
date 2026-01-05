import { getTokenDiscoveryApiUrl } from "@/config";
import { TokenInterface } from "@/constants";
import { log } from "@/utils";

// Token info from ZondScan API
interface ZondScanToken {
  contractAddress: string;
  holderAddress: string;
  balance: string;
  name: string;
  symbol: string;
  decimals: number;
  blockNumber: string;
  updatedAt: string;
}

// API response wrapper from ZondScan
interface ZondScanTokenResponse {
  address: string;
  tokens: ZondScanToken[];
  count: number;
}

/**
 * Discovers QRC-20 tokens held by an address using the ZondScan API
 * @param address - The wallet address to check for tokens
 * @param blockchain - The blockchain network (e.g., "TEST_NET", "MAIN_NET")
 * @returns Array of discovered tokens with balances
 */
export async function discoverTokens(
  address: string,
  blockchain: string
): Promise<TokenInterface[]> {
  try {
    const apiUrl = getTokenDiscoveryApiUrl(address, blockchain);
    log(`Discovering tokens for ${address} from ${apiUrl}`);

    const response = await fetch(apiUrl);

    if (!response.ok) {
      // 404 means no tokens found - not an error
      if (response.status === 404) {
        log(`No tokens found for ${address}`);
        return [];
      }
      throw new Error(`Token discovery failed: ${response.statusText}`);
    }

    const data: ZondScanTokenResponse = await response.json();

    if (!data || !Array.isArray(data.tokens)) {
      log(`Invalid token discovery response format`);
      return [];
    }

    const tokens: TokenInterface[] = data.tokens
      .filter((token) => token.contractAddress)
      .map((token) => ({
        name: token.name || "Unknown Token",
        symbol: token.symbol || "???",
        address: token.contractAddress.startsWith("Z")
          ? token.contractAddress
          : `Z${token.contractAddress.replace(/^0x/i, "")}`,
        amount: token.balance || "0",
        decimals: token.decimals || 18,
      }));

    log(`Discovered ${tokens.length} tokens for ${address}`);
    return tokens;
  } catch (error) {
    console.error("Error discovering tokens:", error);
    log(`Token discovery error: ${error}`);
    return [];
  }
}

/**
 * Merges discovered tokens with existing token list, avoiding duplicates
 * @param existingTokens - Current token list
 * @param discoveredTokens - Newly discovered tokens
 * @returns Merged token list with no duplicates
 */
export function mergeTokenLists(
  existingTokens: TokenInterface[],
  discoveredTokens: TokenInterface[]
): TokenInterface[] {
  const existingAddresses = new Set(
    existingTokens.map((t) => t.address.toLowerCase())
  );

  const newTokens = discoveredTokens.filter(
    (token) => !existingAddresses.has(token.address.toLowerCase())
  );

  return [...existingTokens, ...newTokens];
}
