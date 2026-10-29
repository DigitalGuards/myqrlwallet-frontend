// ABI selectors: see __fixtures__/quantaVault/README.md for provenance.
export const VAULT_SELECTORS = [
  {
    name: "addOwnerWithThreshold",
    inputs: [
      {
        name: "owner",
        type: "address",
      },
      {
        name: "_threshold",
        type: "uint256",
      },
    ],
    selector: "0x0d582f13",
  },
  {
    name: "approveHash",
    inputs: [
      {
        name: "hashToApprove",
        type: "bytes64",
      },
    ],
    selector: "0xaba381df",
  },
  {
    name: "changeThreshold",
    inputs: [
      {
        name: "_threshold",
        type: "uint256",
      },
    ],
    selector: "0x694e80c3",
  },
  {
    name: "disableModule",
    inputs: [
      {
        name: "prevModule",
        type: "address",
      },
      {
        name: "module",
        type: "address",
      },
    ],
    selector: "0xe009cfde",
  },
  {
    name: "enableModule",
    inputs: [
      {
        name: "module",
        type: "address",
      },
    ],
    selector: "0x610b5925",
  },
  {
    name: "execTransaction",
    inputs: [
      {
        name: "to",
        type: "address",
      },
      {
        name: "value",
        type: "uint256",
      },
      {
        name: "data",
        type: "bytes",
      },
      {
        name: "operation",
        type: "uint8",
      },
      {
        name: "safeTxGas",
        type: "uint256",
      },
      {
        name: "baseGas",
        type: "uint256",
      },
      {
        name: "gasPrice",
        type: "uint256",
      },
      {
        name: "gasToken",
        type: "address",
      },
      {
        name: "refundReceiver",
        type: "address",
      },
      {
        name: "signatures",
        type: "bytes",
      },
      {
        name: "validUntil",
        type: "uint256",
      },
    ],
    selector: "0x81978e5c",
  },
  {
    name: "execTransactionFromModule",
    inputs: [
      {
        name: "to",
        type: "address",
      },
      {
        name: "value",
        type: "uint256",
      },
      {
        name: "data",
        type: "bytes",
      },
      {
        name: "operation",
        type: "uint8",
      },
    ],
    selector: "0x468721a7",
  },
  {
    name: "execTransactionFromModuleReturnData",
    inputs: [
      {
        name: "to",
        type: "address",
      },
      {
        name: "value",
        type: "uint256",
      },
      {
        name: "data",
        type: "bytes",
      },
      {
        name: "operation",
        type: "uint8",
      },
    ],
    selector: "0x5229073f",
  },
  {
    name: "removeOwner",
    inputs: [
      {
        name: "prevOwner",
        type: "address",
      },
      {
        name: "owner",
        type: "address",
      },
      {
        name: "_threshold",
        type: "uint256",
      },
    ],
    selector: "0xf8dc5dd9",
  },
  {
    name: "setFallbackHandler",
    inputs: [
      {
        name: "handler",
        type: "address",
      },
    ],
    selector: "0xf08a0323",
  },
  {
    name: "setGuard",
    inputs: [
      {
        name: "guard",
        type: "address",
      },
    ],
    selector: "0xe19a9dd9",
  },
  {
    name: "setModuleGuard",
    inputs: [
      {
        name: "moduleGuard",
        type: "address",
      },
    ],
    selector: "0xe068df37",
  },
  {
    name: "simulateAndRevert",
    inputs: [
      {
        name: "targetContract",
        type: "address",
      },
      {
        name: "calldataPayload",
        type: "bytes",
      },
    ],
    selector: "0xb4faba09",
  },
  {
    name: "swapOwner",
    inputs: [
      {
        name: "prevOwner",
        type: "address",
      },
      {
        name: "oldOwner",
        type: "address",
      },
      {
        name: "newOwner",
        type: "address",
      },
    ],
    selector: "0xe318b52b",
  },
  {
    name: "cancel",
    inputs: [
      {
        name: "id",
        type: "bytes32",
      },
    ],
    selector: "0xc4d252f5",
  },
  {
    name: "execute",
    inputs: [
      {
        name: "target",
        type: "address",
      },
      {
        name: "value",
        type: "uint256",
      },
      {
        name: "payload",
        type: "bytes",
      },
      {
        name: "predecessor",
        type: "bytes32",
      },
      {
        name: "salt",
        type: "bytes32",
      },
    ],
    selector: "0x134008d3",
  },
  {
    name: "executeBatch",
    inputs: [
      {
        name: "targets",
        type: "address[]",
      },
      {
        name: "values",
        type: "uint256[]",
      },
      {
        name: "payloads",
        type: "bytes[]",
      },
      {
        name: "predecessor",
        type: "bytes32",
      },
      {
        name: "salt",
        type: "bytes32",
      },
    ],
    selector: "0xe38335e5",
  },
  {
    name: "grantRole",
    inputs: [
      {
        name: "role",
        type: "bytes32",
      },
      {
        name: "account",
        type: "address",
      },
    ],
    selector: "0x2f2ff15d",
  },
  {
    name: "renounceRole",
    inputs: [
      {
        name: "role",
        type: "bytes32",
      },
      {
        name: "callerConfirmation",
        type: "address",
      },
    ],
    selector: "0x36568abe",
  },
  {
    name: "revokeRole",
    inputs: [
      {
        name: "role",
        type: "bytes32",
      },
      {
        name: "account",
        type: "address",
      },
    ],
    selector: "0xd547741f",
  },
  {
    name: "schedule",
    inputs: [
      {
        name: "target",
        type: "address",
      },
      {
        name: "value",
        type: "uint256",
      },
      {
        name: "data",
        type: "bytes",
      },
      {
        name: "predecessor",
        type: "bytes32",
      },
      {
        name: "salt",
        type: "bytes32",
      },
      {
        name: "delay",
        type: "uint256",
      },
    ],
    selector: "0x01d5062a",
  },
  {
    name: "scheduleBatch",
    inputs: [
      {
        name: "targets",
        type: "address[]",
      },
      {
        name: "values",
        type: "uint256[]",
      },
      {
        name: "payloads",
        type: "bytes[]",
      },
      {
        name: "predecessor",
        type: "bytes32",
      },
      {
        name: "salt",
        type: "bytes32",
      },
      {
        name: "delay",
        type: "uint256",
      },
    ],
    selector: "0x8f2a0bb0",
  },
  {
    name: "updateDelay",
    inputs: [
      {
        name: "newDelay",
        type: "uint256",
      },
    ],
    selector: "0x64d62353",
  },
  {
    name: "multiSend",
    inputs: [
      {
        name: "transactions",
        type: "bytes",
      },
    ],
    selector: "0x8d80ff0a",
  },
  {
    name: "signMessage",
    inputs: [
      {
        name: "_data",
        type: "bytes",
      },
    ],
    selector: "0x85a5affe",
  },
  {
    name: "acceptOwnership",
    inputs: [],
    selector: "0x79ba5097",
  },
  {
    name: "transferOwnership",
    inputs: [
      {
        name: "newOwner",
        type: "address",
      },
    ],
    selector: "0xf2fde38b",
  },
  {
    name: "approve",
    inputs: [
      {
        name: "spender",
        type: "address",
      },
      {
        name: "amount",
        type: "uint256",
      },
    ],
    selector: "0x095ea7b3",
  },
  {
    name: "renounceOwnership",
    inputs: [],
    selector: "0x715018a6",
  },
  {
    name: "transfer",
    inputs: [
      {
        name: "recipient",
        type: "address",
      },
      {
        name: "amount",
        type: "uint256",
      },
    ],
    selector: "0xa9059cbb",
  },
  {
    name: "transferFrom",
    inputs: [
      {
        name: "sender",
        type: "address",
      },
      {
        name: "recipient",
        type: "address",
      },
      {
        name: "amount",
        type: "uint256",
      },
    ],
    selector: "0x23b872dd",
  },
] as const;

export const VAULT_ROLES = {
  PROPOSER:
    "0xb09aa5aeb3702cfd50b6b62bc4532604938f21248a27a1d5ca736082b6819cc1",
  EXECUTOR:
    "0xd8aa0f3194971a2a116679f7c2090f6939c8d4e01a2a8d7e41d55e5351469e63",
  CANCELLER:
    "0xfd643c72710c63c0180259aba6b2d05451e3591a24e58b62239378085726f783",
  DEFAULT_ADMIN:
    "0x0000000000000000000000000000000000000000000000000000000000000000",
} as const;
