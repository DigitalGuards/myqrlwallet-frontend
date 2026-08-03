import { describe, expect, it } from "@jest/globals";
import {
  generateConnectionURI,
  KeyExchange as DAppKeyExchange,
  type AckMessage as DAppAckMessage,
  type SynAckMessage as DAppSynAckMessage,
} from "@qrlwallet/connect";

import {
  KeyExchange as WalletKeyExchange,
  type AckMessage as WalletAckMessage,
} from "../KeyExchange";
import {
  computeFingerprint,
  fingerprintEquals,
  parseConnectionURI,
} from "../qrUri";

function wireClone<T>(value: unknown): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

describe("@qrlwallet/connect 4 wallet interoperability", () => {
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
      const dappAck = await dapp.onSynAck(
        cid,
        wireClone<DAppSynAckMessage>(walletSynAck),
      );
      expect(dappAck).not.toBeNull();

      await wallet.onAck(
        wireClone<WalletAckMessage>(dappAck as DAppAckMessage),
      );
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
