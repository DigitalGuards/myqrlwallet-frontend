interface TokenInterface {
    name: string;
    symbol: string;
    address: string;
    amount: string;
    decimals: number;
}

const KNOWN_TOKEN_LIST: TokenInterface[] = [
    {
        name: "Zond Token",
        symbol: "ZT",
        address: "Z9da9298591f541abb436bc1240dea84ba3589dfa",
        amount: "0",
        decimals: 6
    }
]

export { KNOWN_TOKEN_LIST }
export type { TokenInterface }