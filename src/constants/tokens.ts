import { isArray, isRecord } from "@/utils/guards";
export interface TokenInterface {
    name?: unknown;
    symbol?: unknown;
    address: string;
    amount?: unknown;
    decimals?: unknown;
}

export const KNOWN_TOKEN_LIST: TokenInterface[] = [];

// Display identity of the native coin. Ecosystem convention: amounts show
// as "Quanta"; "QRL" stays the project name and exchange ticker.
export const NATIVE_TOKEN = {
    name: "Quanta",
    symbol: "Quanta",
    decimals: 18,
};

/**
 * EIP-6963 rdns values accepted as QRL wallet extensions (qrl_* namespace):
 * the MyQRLWallet Extension fork and the upstream QRL Web3 Wallet. Neither
 * exposes a window global; EIP-6963 announcements are the only discovery.
 */
export const QRL_EXTENSION_RDNS = ["com.qrlwallet.extension", "theqrl.org"] as const;

/** Token-list consumers require string addresses when matching holdings. */
export function tokenListValue(value: unknown): TokenInterface[] {
    if (!isTokenList(value)) throw new TypeError('Invalid token list');
    return value;
}

function isTokenList(value: unknown): value is TokenInterface[] {
    return isArray(value) && value.every((item) =>
        isRecord(item) && typeof item['address'] === 'string',
    );
}
