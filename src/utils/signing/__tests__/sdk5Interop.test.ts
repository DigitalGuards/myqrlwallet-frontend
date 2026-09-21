import { MLDSA87 } from "@theqrl/wallet.js";
import {
  computeTypedDataDigest as sdkTypedDigest,
  isCurrentQrlAddress,
  isQrlSignedMessageResult,
  isQrlSignedTypedDataResult,
  verifyMessageForSigner,
  verifyTypedDataForSigner,
} from "@qrlwallet/connect";
import {
  computeTypedDataDigest,
  signMessage,
  signTypedData,
  type TypedDataPayload,
} from "..";

function ephemeralSeed(): string {
  const wallet = MLDSA87.newWallet();
  try {
    return wallet.getHexExtendedSeed();
  } finally {
    wallet.zeroize();
  }
}

it("SDK5 accepts and verifies the complete wallet QIP-55 message identity", () => {
  const messageBytes = "0x010203";
  const signed = signMessage(messageBytes, ephemeralSeed(), {
    randomized: false,
  });
  expect(signed.signer).toHaveLength(129);
  expect(isCurrentQrlAddress(signed.signer)).toBe(true);
  expect(isQrlSignedMessageResult(signed)).toBe(true);
  expect(
    verifyMessageForSigner({
      ...signed,
      expectedSigner: signed.signer,
      messageBytes,
    }),
  ).toBe(true);
  expect(
    verifyMessageForSigner({
      ...signed,
      expectedSigner: signed.signer.slice(0, 41),
      messageBytes,
    }),
  ).toBe(false);
  expect(
    verifyMessageForSigner({
      ...signed,
      expectedSigner: `Q${"1".repeat(128)}`,
      messageBytes,
    }),
  ).toBe(false);
});

it("SDK5 and wallet agree on supported typed payloads and signer binding", () => {
  const payload: TypedDataPayload = {
    types: {
      QRLDomain: [{ name: "name", type: "string" }],
      Login: [{ name: "nonce", type: "uint64" }],
    },
    domain: { name: "release-test.example" },
    primaryType: "Login",
    message: { nonce: "42" },
  };
  expect(sdkTypedDigest(payload)).toEqual(computeTypedDataDigest(payload));
  const signed = signTypedData(payload, ephemeralSeed(), { randomized: false });
  expect(isQrlSignedTypedDataResult(signed)).toBe(true);
  expect(
    verifyTypedDataForSigner({
      ...signed,
      expectedSigner: signed.signer,
      payload,
    }),
  ).toBe(true);
});

it.each([40, 128])(
  "SDK5 and wallet reject unsupported typed address width %s",
  (width) => {
    const payload: TypedDataPayload = {
      types: {
        QRLDomain: [{ name: "name", type: "string" }],
        Login: [{ name: "owner", type: "address" }],
      },
      domain: { name: "release-test.example" },
      primaryType: "Login",
      message: { owner: `Q${"1".repeat(width)}` },
    };
    expect(() => sdkTypedDigest(payload)).toThrow();
    expect(() => computeTypedDataDigest(payload)).toThrow();
  },
);
