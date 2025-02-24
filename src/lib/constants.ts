interface TokenInterface {
    name: string;
    symbol: string;
    address: string;
    amount: string;
    decimals: number;
}

const KNOWN_TOKEN_LIST: TokenInterface[] = [
    {
        name: "First Zond Token",
        symbol: "FZT",
        address: "0x95437afc410938512c85b61059932c3fe11afe2e",
        amount: "0",
        decimals: 6
    }
]

export { KNOWN_TOKEN_LIST }
export type { TokenInterface }