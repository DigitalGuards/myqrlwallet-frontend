import { describe, expect, it } from "@jest/globals";
import {
  generateConnectionURI,
  KeyExchange as DAppKeyExchange,
  KeyExchangeMessageType as DAppKeyExchangeMessageType,
  type SynAckMessage as DAppSynAckMessage,
} from "@qrlwallet/connect";

import {
  KeyExchange as WalletKeyExchange,
  isAckMessage,
} from "../KeyExchange";
import { isRecord } from "@/utils/guards";
import {
  computeFingerprint,
  fingerprintEquals,
  parseConnectionURI,
} from "../qrUri";

function wireClone(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value));
}

function isDAppSynAckMessage(value: unknown): value is DAppSynAckMessage {
  return (
    isRecord(value) &&
    value["type"] === DAppKeyExchangeMessageType.SYNACK &&
    typeof value["ct"] === "string" &&
    typeof value["c0"] === "string" &&
    typeof value["v"] === "number"
  );
}

describe("@qrlwallet/connect 4 wallet interoperability", () => {
  it.each([
    null,
    [],
    {},
    { type: DAppKeyExchangeMessageType.ACK, ct: "ct", c0: "c0", v: 3 },
    { type: DAppKeyExchangeMessageType.SYNACK, ct: 7, c0: "c0", v: 3 },
    { type: DAppKeyExchangeMessageType.SYNACK, ct: "ct", c0: null, v: 3 },
    { type: DAppKeyExchangeMessageType.SYNACK, ct: "ct", c0: "c0", v: "3" },
  ])("rejects a malformed SYNACK wire shape: %p", (message) => {
    expect(isDAppSynAckMessage(wireClone(message))).toBe(false);
  });

  it("completes a PQP3 handshake and exchanges ciphertext in both directions", async () => {
    const cid = Uint8Array.from({ length: 16 }, (_, index) => index + 1);
    const dapp = new DAppKeyExchange(true);
    const wallet = new WalletKeyExchange();
    const { publicKey, capability } = dapp.initiate();
    let parsedCapability: Uint8Array | null = null;

    try {
      const uri = await generateConnectionURI(cid, publicKey, capability);
      const parsed = await parseConnectionURI(uri);
      parsedCapability = parsed.cap;

      expect(parsed.cid).toEqual(cid);
      expect(
        fingerprintEquals(
          parsed.fp,
          await computeFingerprint(parsed.cid, publicKey, parsed.cap),
        ),
      ).toBe(true);

      const walletSynAck = await wallet.receiveQR(
        parsed.cid,
        publicKey,
        parsed.cap,
      );
      const synAck = wireClone(walletSynAck);
      if (!isDAppSynAckMessage(synAck)) throw new Error("Expected a SYNACK message");
      const dappAck = await dapp.onSynAck(cid, synAck);
      expect(dappAck).not.toBeNull();

      const ack = wireClone(dappAck);
      if (!isAckMessage(ack)) throw new Error("Expected an ACK message");
      await wallet.onAck(ack);
      dapp.confirmOriginatorAckDelivered();

      expect(dapp.areKeysExchanged()).toBe(true);
      expect(wallet.areKeysExchanged()).toBe(true);

      const dappCiphertext = await dapp.encryptMessage("dapp-to-wallet");
      await expect(wallet.decryptMessage(dappCiphertext)).resolves.toBe(
        "dapp-to-wallet",
      );

      const walletCiphertext = await wallet.encryptMessage("wallet-to-dapp");
      await expect(dapp.decryptMessage(walletCiphertext)).resolves.toBe(
        "wallet-to-dapp",
      );
    } finally {
      publicKey.fill(0);
      capability.fill(0);
      parsedCapability?.fill(0);
      dapp.reset();
    }
  });
});
