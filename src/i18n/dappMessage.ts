import type { TFunction } from "i18next";

export type DAppTranslator = TFunction<
  ["dapps", "common", "settings", "transfer"]
>;

/** Translate wallet-owned errors at display time. Protocol replies, stored outcomes
 * and unknown external details retain their original bytes.
 */
export function dappMessage(message: string, t: DAppTranslator): string {
  switch (message) {
    case "Connection failed":
      return t("dapps:connectionFailed");
    case "No pending connection":
      return t("dapps:noPending");
    case "Wallet identity is changing; retry the connection":
      return t("dapps:identityChanging");
    case "Wallet identity changed during QRL Connect operation":
      return t("dapps:identityChanged");
    case "Wallet identity changed while reading the connection":
      return t("dapps:identityReading");
    case "Wallet identity changed while opening the connection":
      return t("dapps:identityOpening");
    case "This QRL Connect session is active in another wallet tab, or this browser cannot safely lock it":
      return t("dapps:sessionLocked");
    case "This wallet pairs only through the qrlwallet.com relay. Ask the dApp to use it, or pair from the web wallet.":
      return t("dapps:relayRestricted");
    case "dApp has not registered its public key with the relay yet; retry the scan":
      return t("dapps:publicKeyPending");
    case "Relay-provided public key does not match the fingerprint from the QR":
      return t("dapps:fingerprintMismatch");
    case "Previous wallet connection is still being cleared":
      return t("dapps:clearingConnection");
    case "Scanned QR does not match the already-connected dApp for this channel":
      return t("dapps:qrMismatch");
    case "Relay returned an invalid buffered message list":
      return t("dapps:relayList");
    case "Relay returned a malformed buffered message":
      return t("dapps:relayMessage");
    case "Relay returned an invalid ML-KEM public key":
      return t("dapps:relayKey");
    case "Relay reported a terminated or malformed channel":
      return t("dapps:relayTerminated");
    case "Relay returned malformed buffered messages":
      return t("dapps:relayMessages");
    case "Relay returned too many buffered messages":
      return t("dapps:relayTooMany");
    case "Relay returned a malformed channel public key":
      return t("dapps:relayChannelKey");
    case "Relay returned a malformed termination status":
      return t("dapps:relayStatus");
    case "Socket connection cancelled":
      return t("dapps:socketCancelled");
    case "Socket connect timeout":
      return t("dapps:socketTimeout");
    case "qrUri: empty URI":
      return t("dapps:uriEmpty");
    case "qrUri: malformed URI":
      return t("dapps:uriMalformed");
    case "qrUri: not a qrlconnect URI":
      return t("dapps:uriScheme");
    case "qrUri: invalid relay URL":
      return t("dapps:uriRelay");
    case "qrUri: legacy v1 URI - this wallet requires a PQP3 dApp":
      return t("dapps:uriLegacy");
    case "qrUri: unknown query parameter":
      return t("dapps:uriQuery");
    case "qrUri: duplicate q parameter":
      return t("dapps:uriDuplicateQ");
    case "qrUri: duplicate r parameter":
      return t("dapps:uriDuplicateR");
    case "qrUri: missing q parameter":
      return t("dapps:uriMissingQ");
    case "qrUri: bad PQP3 magic":
      return t("dapps:uriMagic");
    case "qrUri: WebCrypto SubtleCrypto is not available":
      return t("dapps:uriCrypto");
    case "base45: invalid input length":
      return t("dapps:base45Length");
    case "base45: invalid character":
      return t("dapps:base45Character");
    case "base45: decoded group exceeds 0xFFFF":
      return t("dapps:base45Group");
    case "base45: decoded byte exceeds 0xFF":
      return t("dapps:base45Byte");
  }
  if (message.startsWith("qrUri: base45 decode failed: "))
    return t("dapps:uriBase45", { reason: dappMessage(message.slice(29), t) });
  const uriLong = /^qrUri: URI exceeds (\d+) characters$/.exec(message);
  if (uriLong) return t("dapps:uriTooLong", { limit: uriLong[1] });
  const payloadLong = /^qrUri: PQP3 payload exceeds (\d+) characters$/.exec(
    message,
  );
  if (payloadLong) return t("dapps:uriPayloadLong", { limit: payloadLong[1] });
  const blob = /^qrUri: expected (\d+)-byte blob, got (\d+)$/.exec(message);
  if (blob) return t("dapps:uriBlob", { expected: blob[1], actual: blob[2] });
  const legacy =
    /^qrUri: legacy (PQP[12]) URI - regenerate the QR with @qrlwallet\/connect 4 or newer$/.exec(
      message,
    );
  if (legacy) return t("dapps:uriLegacyPqp", { version: legacy[1] });
  return message;
}
