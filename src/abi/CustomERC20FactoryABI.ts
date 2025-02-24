const customERC20FactoryABI: [
    {
        "anonymous": false,
        "inputs": [
            {
                "indexed": true,
                "internalType": "address",
                "name": "tokenAddress",
                "type": "address"
            },
            {
                "indexed": true,
                "internalType": "address",
                "name": "owner",
                "type": "address"
            }
        ],
        "name": "TokenCreated",
        "type": "event"
    },
    {
        "type": "function",
        "name": "createToken",
        "inputs": [
            {
                "internalType": "string",
                "name": "name_",
                "type": "string"
            },
            {
                "internalType": "string",
                "name": "symbol_",
                "type": "string"
            },
            {
                "internalType": "uint256",
                "name": "initialSupply_",
                "type": "uint256"
            },
            {
                "internalType": "uint8",
                "name": "decimals_",
                "type": "uint8"
            },
            {
                "internalType": "uint256",
                "name": "maxSupply_",
                "type": "uint256"
            },
            {
                "internalType": "address",
                "name": "recipient_",
                "type": "address"
            },
            {
                "internalType": "address",
                "name": "owner_",
                "type": "address"
            },
            {
                "internalType": "uint256",
                "name": "maxWalletAmount_",
                "type": "uint256"
            },
            {
                "internalType": "uint256",
                "name": "maxTxLimit_",
                "type": "uint256"
            }
        ],
        "outputs": [
            {
                "internalType": "address",
                "name": "",
                "type": "address"
            }
        ],
        "stateMutability": "nonpayable"
    }] = [
        {
            "anonymous": false,
            "inputs": [
                {
                    "indexed": true,
                    "internalType": "address",
                    "name": "tokenAddress",
                    "type": "address"
                },
                {
                    "indexed": true,
                    "internalType": "address",
                    "name": "owner",
                    "type": "address"
                }
            ],
            "name": "TokenCreated",
            "type": "event"
        },
        {
            "type": "function",
            "name": "createToken",
            "inputs": [
                {
                    "internalType": "string",
                    "name": "name_",
                    "type": "string"
                },
                {
                    "internalType": "string",
                    "name": "symbol_",
                    "type": "string"
                },
                {
                    "internalType": "uint256",
                    "name": "initialSupply_",
                    "type": "uint256"
                },
                {
                    "internalType": "uint8",
                    "name": "decimals_",
                    "type": "uint8"
                },
                {
                    "internalType": "uint256",
                    "name": "maxSupply_",
                    "type": "uint256"
                },
                {
                    "internalType": "address",
                    "name": "recipient_",
                    "type": "address"
                },
                {
                    "internalType": "address",
                    "name": "owner_",
                    "type": "address"
                },
                {
                    "internalType": "uint256",
                    "name": "maxWalletAmount_",
                    "type": "uint256"
                },
                {
                    "internalType": "uint256",
                    "name": "maxTxLimit_",
                    "type": "uint256"
                }
            ],
            "outputs": [
                {
                    "internalType": "address",
                    "name": "",
                    "type": "address"
                }
            ],
            "stateMutability": "nonpayable"
        }
    ];

export { customERC20FactoryABI };
