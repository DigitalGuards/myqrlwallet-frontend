import type { BlockchainSelection } from "@/utils/storage/storage";
import { getTokenDiscoveryApiUrl } from "@/config";
import type { TokenInterface } from "@/constants";
import { log } from "@/utils";
import { isArray, isRecord, stringValue } from "@/utils/guards";
import { logger } from "@/utils/log";
import { formatUnits } from "@/utils/web3/units";
import { getOptimalTokenBalance } from "@/utils/formatting";

// Explorer metadata is copied verbatim into the persisted token list.
function isExplorerToken(value: unknown): value is {
  contractAddress?: unknown;
  balance?: unknown;
  name?: unknown;
  symbol?: unknown;
  decimals?: unknown;
} {
  return value !== null && value !== undefined;
}

/**
 * Discovers QRC-20 tokens held by an address using the Explorer API
 * @param address - The wallet address to check for tokens
 * @param blockchain - The blockchain network (e.g., "TEST_NET", "MAIN_NET")
 * @returns Array of discovered tokens with balances
 */
export async function discoverTokens(
  address: string,
  blockchain: BlockchainSelection
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

    const data: unknown = await response.json();

    if (!isRecord(data) || !isArray(data["tokens"])) {
      log(`Invalid token discovery response format`);
      return [];
    }

    const tokens: TokenInterface[] = data["tokens"]
      .filter(isExplorerToken)
      .filter((token) => token.contractAddress)
      .map((token) => {
        const symbol = token.symbol || "UNK";
        // Nullish coalescing, not ||: 0 is a valid decimals value and must
        // not fall through to 18.
        const decimals = token.decimals ?? 18;
        // Explorer returns the raw base-unit balance. Pre-format it to the
        // same display string refreshTokenBalances would produce, so the
        // picker (and the token list once added) never flashes the raw
        // integer before the next 30s refresh cycle reformats it.
        let amount: string;
        try {
          amount = getOptimalTokenBalance(
            formatUnits(token.balance || "0", decimals),
            symbol,
            false,
          );
        } catch {
          amount = "0.0";
        }
        return {
          name: token.name || "Unknown Token",
          symbol,
          address: stringValue(token.contractAddress).startsWith("Q")
            ? stringValue(token.contractAddress)
            : stringValue(token.contractAddress).startsWith("q")
              ? `Q${stringValue(token.contractAddress).slice(1)}`
              : `Q${stringValue(token.contractAddress).replace(/^0x/i, "")}`,
          amount,
          decimals,
        };
      });

    log(`Discovered ${tokens.length} tokens for ${address}`);
    return tokens;
  } catch (error) {
    logger.error("Error discovering tokens:", error);
    log(`Token discovery error: ${typeof error === "symbol" ? [error].join("") : String(error)}`);
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
