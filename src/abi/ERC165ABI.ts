// Minimal ERC-165 — only the introspection method we actually call.
// Used to discriminate ERC-721 (interfaceId 0x80ac58cd), ERC-1155
// (0xd9b67a26), and ERC721Enumerable (0x780e9d63) before falling
// through to ERC-20 behaviour.
export const erc165ABI = [
  {
    inputs: [{ internalType: "bytes4", name: "interfaceId", type: "bytes4" }],
    name: "supportsInterface",
    outputs: [{ internalType: "bool", name: "", type: "bool" }],
    stateMutability: "view",
    type: "function",
  },
];

export const ERC165_INTERFACE_IDS = {
  ERC721: "0x80ac58cd",
  ERC721_ENUMERABLE: "0x780e9d63",
  ERC721_METADATA: "0x5b5e139f",
  ERC1155: "0xd9b67a26",
  ERC1155_METADATA_URI: "0x0e89341c",
} as const;
