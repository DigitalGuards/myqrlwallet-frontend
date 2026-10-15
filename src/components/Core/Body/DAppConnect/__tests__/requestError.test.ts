import { computeTypedDataDigest as sdkTypedDataDigest } from "@qrlwallet/connect";
import { RequestHandler } from "@/services/dappConnect/RequestHandler";
import {
  computeTypedDataDigest,
  type TypedDataPayload,
  type TypeMap,
} from "@/utils/signing";
import { formatDAppRequestError } from "../requestError";

it.each(["", " ", "\t\n\r"])(
  "gives blank request errors a display fallback (%j)",
  (message) => {
    expect(formatDAppRequestError(message, "qrl_sendTransaction")).toBe(
      "The request failed.",
    );
  },
);

it.each(["RPC unavailable", "  RPC unavailable  "])(
  "preserves nonblank request errors (%j)",
  (message) => {
    expect(formatDAppRequestError(message, "qrl_sendTransaction")).toBe(
      message,
    );
    expect(formatDAppRequestError(message, "qrl_signTypedData")).toBe(message);
  },
);

it.each([
  [
    "cyclic type reference: Loop -> Loop",
    "Typed data contains a circular type reference.",
  ],
  ["type nesting too deep: uint8[]", "Typed data is nested too deeply."],
  [
    "type graph nesting too deep: Root -> Child",
    "Typed data is nested too deeply.",
  ],
  ["value nesting too deep: Child", "Typed data is nested too deeply."],
])("unifies typed-data display wording for %s", (message, expected) => {
  for (const prefix of [
    "",
    "Typed-data signing failed: ",
    "Typed data signing failed: ",
  ]) {
    expect(formatDAppRequestError(prefix + message, "qrl_signTypedData")).toBe(
      expected,
    );
    expect(formatDAppRequestError(prefix + message, "qrl_signMessage")).toBe(
      prefix + message,
    );
  }
});

function payload(fieldType: string, types: TypeMap = {}): TypedDataPayload {
  return {
    types: {
      QRLDomain: [{ name: "name", type: "string" }],
      Payload: [{ name: "value", type: fieldType }],
      ...types,
    },
    primaryType: "Payload",
    domain: { name: "Validation test" },
    message: { value: [] },
  };
}

const deepTypes: TypeMap = {};
for (let index = 0; index < 13; index += 1) {
  deepTypes[`Node${index}`] = [
    { name: "value", type: index === 12 ? "uint8" : `Node${index + 1}` },
  ];
}

it.each([
  {
    name: "cycle",
    value: payload("Payload"),
    message: "cyclic type reference: Payload -> Payload",
    display: "Typed data contains a circular type reference.",
  },
  {
    name: "array depth",
    value: payload(`uint8${"[]".repeat(13)}`),
    message: "type nesting too deep: uint8",
    display: "Typed data is nested too deeply.",
  },
  {
    name: "struct depth",
    value: payload("Node0", deepTypes),
    message: `type graph nesting too deep: Payload -> ${Array.from({ length: 13 }, (_, index) => `Node${index}`).join(" -> ")}`,
    display: "Typed data is nested too deeply.",
  },
])(
  "preserves the SDK and Connect validation message for $name",
  ({ value, message, display }) => {
    expect(() => computeTypedDataDigest(value)).toThrow(new Error(message));
    expect(() => sdkTypedDataDigest(value)).toThrow(new Error(message));
    expect(() => {
      RequestHandler.validateRestrictedRequest("qrl_signTypedData", [
        `Q${"a".repeat(128)}`,
        value,
      ]);
    }).toThrow(new Error(message));
    expect(formatDAppRequestError(message, "qrl_signTypedData")).toBe(display);
  },
);
