export const address = `Q${"a".repeat(128)}`;
export const ignoredNetworkFields = {
  chainName: "Untrusted network name",
  rpcUrls: [
    "https://rpc.example/\u202euntrusted-network",
    `https://rpc.example/${"x".repeat(10 * 1024)}`,
  ],
};
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
                ...(maximal ? ignoredNetworkFields : {}),
              },
            ]
          : method === "wallet_switchQrlChain"
            ? [{
                chainId: maximal ? `0x${"fF".repeat(32)}` : "0x00301825",
                ...(maximal ? ignoredNetworkFields : {}),
              }]
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

// Reuses the reviewer's ten-level Nested0..Nested9 fixture, including its
// original SENSITIVE leaf. Long leaves exercise wrapping at the same depth.
export function nestedTypedPayload(leaf = "SENSITIVE", depth = 10) {
  const types = { QRLDomain: [{ name: "name", type: "string" }] };
  for (let i = 0; i < depth; i++) {
    types[`Nested${i}`] = [{
      name: "value",
      type: i === depth - 1 ? "string" : `Nested${i + 1}`,
    }];
  }
  let message = { value: leaf };
  for (let i = 1; i < depth; i++) message = { value: message };
  return { types, primaryType: "Nested0", domain: { name: "Example" }, message };
}

export function adversarialFixtures() {
  const token = "x".repeat(2000);
  const messages = [
    ["space", "0x20"],
    ["tab", "0x09"],
    ["newline", "0x0a"],
    ["space-tab-space", "0x200920"],
    ["invisible", `0x${Buffer.from("\u200b\u202e").toString("hex")}`],
    ["empty", "0x"],
    ["token-2000", `0x${Buffer.from(token).toString("hex")}`],
  ].map(([name, hex]) => ({
    name: `message-${name}`,
    approval: { ...fixture("qrl_signMessage"), params: [address, hex] },
    primaryText: name === "token-2000" ? token : name === "empty" ? "Empty message (0 bytes)." : hex,
  }));
  return [
    ...messages,
    ...[
      ["nested-reviewer", nestedTypedPayload()],
      ["nested-token-2000", nestedTypedPayload(token)],
      ["token-2000", nestedTypedPayload(token, 1)],
    ].map(([name, payload]) => ({
      name: `typed-${name}`,
      approval: { ...fixture("qrl_signTypedData"), params: [address, payload] },
      primaryText: JSON.stringify(name === "nested-reviewer" ? "SENSITIVE" : token),
      primaryLabel: name.startsWith("nested-")
        ? "value.value.value.value.value.value.value.value.value.value"
        : undefined,
    })),
  ];
}

// Round 2 review reproductions. Both typed payloads pass ingress and have
// distinct signing digests despite their formerly identical flattened text.
export function collisionFixtures() {
  return [false, true].map((second) => {
    const approval = fixture('qrl_signTypedData');
    const payload = approval.params[1];
    payload.types.Review = [{ name: 'prefix', type: 'string' }, { name: 'order', type: 'Order' }];
    payload.types.Order = second ? [{ name: 'a1b', type: 'uint256' }]
      : [{ name: 'a', type: 'uint256' }, { name: 'b', type: 'uint256' }];
    payload.message = { prefix: 'Visible review context '.repeat(150), order: second ? { a1b: 23 } : { a: 1, b: 23 } };
    return approval;
  });
}

export function roundTwoFixtures() {
  return [
    ...[2, 4].map((length) => {
      const approval = fixture('qrl_signTypedData');
      approval.params[1].types.Review = [{ name: 'items', type: 'uint256[]' }];
      approval.params[1].message = { items: Array.from({ length }, (_, i) => String(i + 1)) };
      return { name: `typed-array-${length}`, approval };
    }),
    ...['record', 'first-level-array'].map((kind) => {
      const approval = fixture('qrl_signTypedData');
      approval.params[1].types.Review = [{ name: 'order', type: 'Order' }];
      approval.params[1].types.Order = [{ name: 'count', type: kind === 'record' ? 'uint256' : 'uint256[]' }];
      approval.params[1].message = { order: { count: kind === 'record' ? '1' : ['1', '2'] } };
      return { name: `typed-${kind}`, approval };
    }),
    ...[['soft-hyphen', '\u00ad'], ['grapheme-joiner', '\u034f'], ['variation-selector', '\ufe0f'], ['hangul-filler', '\u3164']].map(([name, text]) => {
      const approval = fixture('qrl_signMessage');
      approval.dappInfo.name = text;
      return { name, approval };
    }),
  ];
}

export function parityFixtures() {
  return [
    ...methods.flatMap((method) => [false, true].map((maximal) => ({
      name: `${method}-${maximal ? 'max' : 'short'}`, approval: fixture(method, maximal), maximal,
    }))),
    ...adversarialFixtures(),
    ...roundTwoFixtures(),
    ...collisionFixtures().map((approval, i) => ({ name: `queued-collision-${i + 1}`, approval })),
    ...['message', 'identity', 'chain-warning', 'switch-chain-id'].map((kind) => {
      const method = kind === 'switch-chain-id' ? 'wallet_switchQrlChain'
        : kind === 'chain-warning' ? 'qrl_signTypedData' : 'qrl_signMessage';
      const approval = fixture(method);
      if (kind === 'message') approval.params[1] = `0x${'6869'.repeat(512)}`;
      else if (kind === 'identity') approval.dappInfo.url = `https://changed.example/${'a'.repeat(300)}`;
      else if (kind === 'switch-chain-id') approval.params[0].chainId = `0x${'fF'.repeat(32)}`;
      else approval.params[1].domain.chainId = '1';
      return { name: `changed-${kind}`, approval };
    }),
    ...['qrl_signMessage', 'qrl_requestAccounts', 'wallet_addQrlChain', 'wallet_switchQrlChain'].map((method) => ({
      name: `${method}-empty`, approval: fixture(method), empty: true,
    })),
  ];
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
