export const address = `Q${"a".repeat(128)}`;
export const methods = [
  "qrl_sendTransaction",
  "qrl_signTransaction",
  "qrl_signMessage",
  "qrl_signTypedData",
  "wallet_addQrlChain",
  "wallet_switchQrlChain",
  "qrl_requestAccounts",
  "consent",
];

export function fixture(method, maximal = false) {
  const long = "review every character ".repeat(200);
  const transaction = {
    from: address,
    to: `Q${"b".repeat(128)}`,
    value: "0x1",
    ...(maximal
      ? { data: `0x${"ab".repeat(4096)}`, gas: "0x5208", chainId: "0x301825" }
      : {}),
  };
  const payload = {
    types: {
      QRLDomain: [
        { name: "name", type: "string" },
        { name: "chainId", type: "uint256" },
      ],
      Review: [
        { name: "text", type: "string" },
        ...(maximal ? [{ name: "items", type: "uint256[]" }] : []),
      ],
    },
    primaryType: "Review",
    domain: { name: "Example", chainId: maximal ? "1" : "3151909" },
    message: {
      text: maximal ? "x".repeat(16384) : "Hello",
      ...(maximal
        ? { items: Array.from({ length: 256 }, (_, i) => String(i)) }
        : {}),
    },
  };
  const params = method.includes("Transaction")
    ? [transaction]
    : method === "qrl_signMessage"
      ? [address, `0x${Buffer.from(maximal ? long : "Hello").toString("hex")}`]
      : method === "qrl_signTypedData"
        ? [address, payload]
        : method === "wallet_addQrlChain"
          ? [
              {
                chainId: "0x301825",
                chainName: maximal ? "Network ".repeat(18) : "QRL",
                rpcUrls: [
                  maximal
                    ? `https://rpc.example/${"a".repeat(2000)}`
                    : "https://rpc.example",
                ],
                nativeCurrency: { name: "Quanta", symbol: "QRL", decimals: 18 },
              },
            ]
          : method === "wallet_switchQrlChain"
            ? [{ chainId: maximal ? `0x${"f".repeat(64)}` : "0x301825" }]
            : [];
  return {
    method,
    params,
    dappInfo: {
      name: maximal ? "A".repeat(128) : "Test dApp",
      url: maximal
        ? `https://dapp.example/${"a".repeat(2027)}`
        : "https://dapp.example",
      chainId: "0x301825",
    },
  };
}

export function consentURI(maximal = false) {
  const alphabet = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ $%*+-./:";
  const bytes = Buffer.concat([Buffer.from("PQP3"), Buffer.alloc(80, 1)]);
  let encoded = "";
  for (let i = 0; i < bytes.length; i += 2) {
    let value = bytes[i] * 256 + bytes[i + 1];
    encoded += alphabet[value % 45];
    value = Math.floor(value / 45);
    encoded += alphabet[value % 45] + alphabet[Math.floor(value / 45)];
  }
  const relay = maximal
    ? `https://${"a".repeat(63)}.${"b".repeat(63)}.${"c".repeat(63)}.example`
    : "https://relay.example";
  return `qrlconnect://?${new URLSearchParams({ q: encoded, r: relay })}`;
}

export function rpcAnswer(method) {
  switch (method) {
    case "net_listening":
      return true;
    case "net_version":
      return "3151909";
    case "qrl_chainId":
      return "0x301825";
    case "qrl_getBlockByNumber":
      return {
        hash: `0x${"a".repeat(64)}`,
        number: "0x1",
        baseFeePerGas: "0x3b9aca00",
      };
    case "qrl_gasPrice":
      return "0x3b9aca00";
    case "qrl_maxPriorityFeePerGas":
      return "0x1";
    case "qrl_estimateGas":
      return "0x5208";
    default:
      return "0x0";
  }
}
