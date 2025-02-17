interface TokenInterface {
    name: string;
    symbol: string;
    address: string;
    amount: string;
}

const KNOWN_TOKEN_LIST: TokenInterface[] = [
    {
        name: "Tether USD",
        symbol: "USDT",
        address: "0x0000000000000000000000000000000000000042",
        amount: "0"
    }
]

export { KNOWN_TOKEN_LIST }
export type { TokenInterface }