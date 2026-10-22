import { signingMessage } from "./signingMessage";
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
    case "The request failed.":
      return t("dapps:requestFailed");
    case "Typed data contains a circular type reference.":
      return t("dapps:circularType");
    case "Typed data is nested too deeply.":
      return t("dapps:deepType");
    case "Insufficient funds for this transaction.":
      return t("dapps:insufficientFunds");
    case "Transaction nonce is too low. Please retry.":
      return t("dapps:nonceLow");
    case "This transaction was already submitted.":
      return t("dapps:alreadySubmitted");
    case "Request was rejected.":
      return t("dapps:requestRejected");
    case "Transaction failed. Please verify details and try again.":
      return t("dapps:transactionFailed");
    case "Please enter your PIN":
      return t("dapps:pinRequired");
    case "Wallet changed while preparing the request":
      return t("dapps:walletChanged");
    case "No encrypted seed found":
      return t("dapps:noSeed");
    case "Wallet device security credential unavailable; re-import the seed":
      return t("dapps:credentialUnavailable");
    case "No active account":
      return t("dapps:noAccount");
    case "Signer mismatch: request is for a different account":
      return t("dapps:signerMismatch");
    case "Web3 not initialized":
      return t("dapps:web3Unavailable");
    case "Failed to sign transaction":
      return t("dapps:signFailed");
    case "Transaction has been reverted by the QRVM":
      return t("dapps:revertedQrvm");
    case "Transaction status is unavailable.":
      return t("dapps:statusUnavailable");
    case "Transaction was broadcast, but confirmation is unavailable. Check the explorer before sending again.":
      return t("dapps:broadcastUnconfirmed");
    case "Transaction confirmation is unavailable. Check the explorer before sending again.":
      return t("dapps:confirmationUnavailable");
    case "This transaction is already in the network queue. Check the explorer before sending it again.":
      return t("dapps:alreadyQueued");
    case "The network did not confirm whether this transaction was accepted. Check the explorer before sending it again.":
      return t("dapps:broadcastUnknown");
    case "This transaction would fail on chain, so it was not sent.":
      return t("dapps:wouldRevert");
    case "the stored seed does not match the requested signer":
      return t("dapps:storedSignerMismatch");
    case "the desktop signer does not match the requested signer":
      return t("dapps:desktopSignerMismatch");
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
    case "Failed to unlock the seed. Please try again.":
      return t("transfer:unlockFailed");
    case "Another PIN check is still running. Please try again.":
      return t("settings:pinBusy");
  }
  const attempts = /^Incorrect PIN\. (\d+) attempts? remaining\.$/.exec(
    message,
  );
  if (attempts)
    return t("settings:incorrectPin", { count: Number(attempts[1]) });
  const lockout =
    /^Too many failed attempts\. Please wait (\d+) minutes?\.$/.exec(message);
  if (lockout) return t("settings:lockout", { count: Number(lockout[1]) });
  if (message.startsWith("Message signing failed: "))
    return t("dapps:messageSigningFailed", {
      reason: dappMessage(message.slice(24), t),
    });
  if (message.startsWith("Typed data signing failed: "))
    return t("dapps:typedSigningFailed", {
      reason: dappMessage(message.slice(27), t),
    });
  if (message.startsWith("Typed-data signing failed: "))
    return t("dapps:desktopTypedSigningFailed", {
      reason: dappMessage(message.slice(27), t),
    });
  if (message.startsWith("Invalid qrl_signMessage params: "))
    return t("dapps:invalidMessageParams", { reason: message.slice(32) });
  if (message.startsWith("Invalid qrl_signTypedData params: "))
    return t("dapps:invalidTypedParams", { reason: message.slice(34) });
  if (message.startsWith("This transaction would fail on chain: "))
    return t("dapps:wouldRevertReason", { reason: message.slice(38) });
  if (message.startsWith("qrUri: base45 decode failed: "))
    return t("dapps:uriBase45", { reason: dappMessage(message.slice(29), t) });
  const scheme =
    /^the desktop signer used (.*), the payload requires (.*)$/.exec(message);
  if (scheme)
    return t("dapps:desktopSchemeMismatch", {
      actual: scheme[1],
      required: scheme[2],
    });
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
  return signingMessage(message, t);
}
