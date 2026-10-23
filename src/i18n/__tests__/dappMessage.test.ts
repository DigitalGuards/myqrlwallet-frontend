import { readFileSync } from "node:fs";
import { applyLanguage, i18n } from "../index";
import { dappMessage } from "../dappMessage";
import { computeTypedDataDigest, type TypedDataPayload } from "@/utils/signing";
import {
  SignMessageParamsSchema,
  SignTypedDataParamsSchema,
} from "@/utils/signing/types";
import { parseConnectionURI } from "@/services/dappConnect/qrUri";
import { formatDAppRequestError } from "@/components/Core/Body/DAppConnect/requestError";

const translator = () =>
  i18n.getFixedT(null, ["dapps", "common", "settings", "transfer"] as const);
afterEach(async () => {
  await applyLanguage("en");
});

it("translates actual pairing parser failures and preserves their English bytes", async () => {
  const messages: string[] = [];
  for (const uri of [
    "",
    "wrong",
    " qrlconnect://?q=x",
    "qrlconnect://?channelId=x",
    "qrlconnect://?unknown=x",
    "qrlconnect://?q=x&q=y",
    "qrlconnect://?r=x&r=y",
    "qrlconnect://",
    "qrlconnect://?q=1",
    "qrlconnect://?q=!!",
    `qrlconnect://?q=${"a".repeat(4096)}`,
  ]) {
    try {
      await parseConnectionURI(uri);
      throw new Error("Fixture unexpectedly accepted");
    } catch (error) {
      if (!(error instanceof Error)) throw error;
      messages.push(error.message);
    }
  }
  for (const language of ["en", "de", "es", "ru", "zh-CN"] as const) {
    await applyLanguage(language);
    for (const message of messages) {
      const result = dappMessage(message, translator());
      if (language === "en") expect(result).toBe(message);
      else expect(result).not.toBe(message);
      expect(result).not.toContain("{{");
    }
  }
});
it("covers the wallet-owned schema literals without translating field paths", async () => {
  const source = readFileSync("src/utils/signing/types.ts", "utf8");
  const messages = [...source.matchAll(/message: '([^']+)'/g)].flatMap(
    (match) => (match[1] ? [match[1]] : []),
  );
  expect(messages).toHaveLength(5);
  for (const language of ["en", "de", "es", "ru", "zh-CN"] as const) {
    await applyLanguage(language);
    for (const message of messages) {
      if (language === "en")
        expect(dappMessage(message, translator())).toBe(message);
      else expect(dappMessage(message, translator())).not.toBe(message);
    }
  }
});
it("translates actual schema shape failures while retaining types, field names and bounds", async () => {
  const address = `Q${"1".repeat(128)}`;
  const payload = {
    types: { QRLDomain: [{ name: "name", type: "string" }] },
    primaryType: "Challenge",
    domain: { name: "Exact domain" },
    message: {},
  };
  const messages = new Set(["Invalid input"]);
  for (const [schema, inputs] of [
    [
      SignMessageParamsSchema,
      [undefined, {}, [], [address], [address, {}, "extra"]],
    ],
    [
      SignTypedDataParamsSchema,
      [
        [address, {}],
        [address, { ...payload, primaryType: "" }],
        [address, { ...payload, types: { "": [] } }],
        [address, { ...payload, "Exact field: 名字": 1 }],
        [address, { ...payload, "Exact field: 名字": 1, "second field": 2 }],
      ],
    ],
  ] as const) {
    for (const input of inputs) {
      const parsed = schema.safeParse(input);
      expect(parsed.success).toBe(false);
      if (!parsed.success)
        for (const issue of parsed.error.issues) messages.add(issue.message);
    }
  }
  expect(
    [...messages].some((message) => message.includes("expected tuple")),
  ).toBe(true);
  expect([...messages].some((message) => message.includes("<=2 items"))).toBe(
    true,
  );
  for (const language of ["en", "de", "es", "ru", "zh-CN"] as const) {
    await applyLanguage(language);
    for (const message of messages) {
      const result = dappMessage(message, translator());
      if (language === "en") expect(result).toBe(message);
      else expect(result).not.toBe(message);
      for (const token of [
        "Exact field: 名字",
        "second field",
        ">=1",
        "<=2",
        ">2",
      ])
        if (message.includes(token)) expect(result).toContain(token);
      expect(result).not.toContain("{{");
    }
  }
});
it("translates encoder failures from real malformed typed-data payloads", async () => {
  const base: TypedDataPayload = {
    types: {
      QRLDomain: [{ name: "name", type: "string" }],
      Challenge: [{ name: "text", type: "string" }],
    },
    primaryType: "Challenge",
    domain: { name: "Example domain" },
    message: { text: "Exact message" },
  };
  const inputs: TypedDataPayload[] = [
    { ...base, message: {} },
    { ...base, message: { text: 1 } },
    { ...base, message: { text: "Exact message", extra: 1 } },
    { ...base, message: { text: "Exact message", "exact\nfield: tail": 1 } },
    {
      ...base,
      types: {
        ...base.types,
        Challenge: [{ name: "exact\nfield: tail", type: "string" }],
      },
    },
    {
      ...base,
      types: {
        ...base.types,
        Challenge: [{ name: "text", type: "uint256" }],
      },
      message: { text: "1\n2" },
    },
    { ...base, primaryType: "Missing" },
    { ...base, primaryType: "QRLDomain" },
    {
      ...base,
      types: { ...base.types, Unused: [{ name: "value", type: "string" }] },
    },
    {
      ...base,
      types: { ...base.types, Challenge: [{ name: "value", type: "uint7" }] },
    },
    {
      ...base,
      types: {
        ...base.types,
        QRLDomain: [{ name: "chainId", type: "uint256" }],
      },
    },
    {
      ...base,
      types: { ...base.types, QRLDomain: [{ name: "name", type: "uint256" }] },
    },
    {
      ...base,
      types: { ...base.types, QRLDomain: [{ name: "extra", type: "string" }] },
    },
    {
      ...base,
      types: {
        ...base.types,
        Challenge: [{ name: "text", type: "Challenge" }],
      },
    },
  ];
  const messages = inputs.map((input) => {
    try {
      computeTypedDataDigest(input);
      throw new Error("Fixture unexpectedly accepted");
    } catch (error) {
      if (!(error instanceof Error)) throw error;
      return formatDAppRequestError(error.message, "qrl_signTypedData");
    }
  });
  for (const language of ["en", "de", "es", "ru", "zh-CN"] as const) {
    await applyLanguage(language);
    for (const message of messages) {
      const translated = dappMessage(message, translator());
      if (language === "en") expect(translated).toBe(message);
      else expect(translated).not.toBe(message);
      for (const raw of ["exact\nfield: tail", "1\n2"])
        if (message.includes(raw)) expect(translated).toContain(raw);
    }
  }
});
it.each(["en", "de", "es", "ru", "zh-CN"] as const)(
  "preserves external details and signing wrappers in %s",
  async (language) => {
    await applyLanguage(language);
    const reason =
      "External node diagnostic: https://dapp.example Q123 0xabcd 123.4500";
    expect(dappMessage(reason, translator())).toBe(reason);
    expect(
      dappMessage(`Message signing failed: ${reason}`, translator()),
    ).toContain(reason);
    expect(
      dappMessage(
        `This transaction would fail on chain: ${reason}`,
        translator(),
      ),
    ).toContain(reason);
    expect(
      dappMessage(
        'QRLDomain field "verifyingContract" must be type "address", got "string"',
        translator(),
      ),
    ).toContain('"verifyingContract"');
  },
);

it.each(["en", "de", "es", "ru", "zh-CN"] as const)(
  "keeps complete error tails in %s",
  async (language) => {
    await applyLanguage(language);
    const reason =
      "<b>external</b> dapps:approve {{amount}} Q123 0x00\nsecond line";
    for (const prefix of [
      "Message signing failed: ",
      "Typed data signing failed: ",
      "Typed-data signing failed: ",
      "Transaction signing failed: ",
      "This transaction would fail on chain: ",
    ])
      expect(dappMessage(prefix + reason, translator())).toContain(reason);
    for (const prefix of [
      "unknown type: ",
      "field type too long: ",
      "bad field in ",
      "missing field ",
    ])
      expect(
        dappMessage(prefix + "Exact_path[2].field", translator()),
      ).toContain("Exact_path[2].field");
    for (const value of ["constructor", "toString", "__proto__", reason])
      expect(dappMessage(value, translator())).toBe(value);
  },
);
