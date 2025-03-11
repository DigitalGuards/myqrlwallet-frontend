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
        address: "Ze751329662b34456f14c5e5be04b06f40fbee96a",
        amount: "0",
        decimals: 18
    }
]

export { KNOWN_TOKEN_LIST }
export type { TokenInterface }