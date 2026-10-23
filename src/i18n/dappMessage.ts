import type { ParseKeys, TFunction } from "i18next";

export type DAppTranslator = TFunction<
  ["dapps", "common", "settings", "transfer"]
>;
type ErrorKey = ParseKeys<["dapps", "common", "settings", "transfer"]>;

interface WalletErrorMessage {
  readonly message: string;
  readonly key: ErrorKey;
  readonly values?: Readonly<Record<string, string | number>>;
}
interface WalletErrorWrapper {
  readonly prefix: string;
  readonly key: ErrorKey;
  readonly variable: "reason" | "value" | "keys";
}

// Closed inventory, audited against the producers in docs/DAPP-ERRORS.md.
// Counts and limits below are full strings, never parsed from an error.
export const walletErrorMessages: readonly WalletErrorMessage[] = [
  {
    message: "User rejected the request",
    key: "dapps:desktopRejected",
  },
  {
    message: "Desktop signing failed",
    key: "dapps:desktopSigningFailed",
  },
  {
    message: "Connection failed",
    key: "dapps:connectionFailed",
  },
  {
    message: "The request failed.",
    key: "dapps:requestFailed",
  },
  {
    message: "Typed data contains a circular type reference.",
    key: "dapps:circularType",
  },
  {
    message: "Typed data is nested too deeply.",
    key: "dapps:deepType",
  },
  {
    message: "Insufficient funds for this transaction.",
    key: "dapps:insufficientFunds",
  },
  {
    message: "Transaction nonce is too low. Please retry.",
    key: "dapps:nonceLow",
  },
  {
    message: "This transaction was already submitted.",
    key: "dapps:alreadySubmitted",
  },
  {
    message: "Request was rejected.",
    key: "dapps:requestRejected",
  },
  {
    message: "Transaction failed. Please verify details and try again.",
    key: "dapps:transactionFailed",
  },
  {
    message: "Please enter your PIN",
    key: "dapps:pinRequired",
  },
  {
    message: "Wallet changed while preparing the request",
    key: "dapps:walletChanged",
  },
  {
    message: "No encrypted seed found",
    key: "dapps:noSeed",
  },
  {
    message:
      "Wallet device security credential unavailable; re-import the seed",
    key: "dapps:credentialUnavailable",
  },
  {
    message: "No active account",
    key: "dapps:noAccount",
  },
  {
    message: "Signer mismatch: request is for a different account",
    key: "dapps:signerMismatch",
  },
  {
    message: "Web3 not initialized",
    key: "dapps:web3Unavailable",
  },
  {
    message: "Failed to sign transaction",
    key: "dapps:signFailed",
  },
  {
    message: "Transaction has been reverted by the QRVM",
    key: "dapps:revertedQrvm",
  },
  {
    message: "Transaction status is unavailable.",
    key: "dapps:statusUnavailable",
  },
  {
    message:
      "Transaction was broadcast, but confirmation is unavailable. Check the explorer before sending again.",
    key: "dapps:broadcastUnconfirmed",
  },
  {
    message:
      "Transaction confirmation is unavailable. Check the explorer before sending again.",
    key: "dapps:confirmationUnavailable",
  },
  {
    message:
      "This transaction is already in the network queue. Check the explorer before sending it again.",
    key: "dapps:alreadyQueued",
  },
  {
    message:
      "The network did not confirm whether this transaction was accepted. Check the explorer before sending it again.",
    key: "dapps:broadcastUnknown",
  },
  {
    message: "This transaction would fail on chain, so it was not sent.",
    key: "dapps:wouldRevert",
  },
  {
    message: "the stored seed does not match the requested signer",
    key: "dapps:storedSignerMismatch",
  },
  {
    message: "the desktop signer does not match the requested signer",
    key: "dapps:desktopSignerMismatch",
  },
  {
    message: "No pending connection",
    key: "dapps:noPending",
  },
  {
    message: "Wallet identity is changing; retry the connection",
    key: "dapps:identityChanging",
  },
  {
    message: "Wallet identity changed during QRL Connect operation",
    key: "dapps:identityChanged",
  },
  {
    message: "Wallet identity changed while reading the connection",
    key: "dapps:identityReading",
  },
  {
    message: "Wallet identity changed while opening the connection",
    key: "dapps:identityOpening",
  },
  {
    message:
      "This QRL Connect session is active in another wallet tab, or this browser cannot safely lock it",
    key: "dapps:sessionLocked",
  },
  {
    message:
      "This wallet pairs only through the qrlwallet.com relay. Ask the dApp to use it, or pair from the web wallet.",
    key: "dapps:relayRestricted",
  },
  {
    message:
      "dApp has not registered its public key with the relay yet; retry the scan",
    key: "dapps:publicKeyPending",
  },
  {
    message:
      "Relay-provided public key does not match the fingerprint from the QR",
    key: "dapps:fingerprintMismatch",
  },
  {
    message: "Previous wallet connection is still being cleared",
    key: "dapps:clearingConnection",
  },
  {
    message:
      "Scanned QR does not match the already-connected dApp for this channel",
    key: "dapps:qrMismatch",
  },
  {
    message: "Relay returned an invalid buffered message list",
    key: "dapps:relayList",
  },
  {
    message: "Relay returned a malformed buffered message",
    key: "dapps:relayMessage",
  },
  {
    message: "Relay returned an invalid ML-KEM public key",
    key: "dapps:relayKey",
  },
  {
    message: "Relay reported a terminated or malformed channel",
    key: "dapps:relayTerminated",
  },
  {
    message: "Relay returned malformed buffered messages",
    key: "dapps:relayMessages",
  },
  {
    message: "Relay returned too many buffered messages",
    key: "dapps:relayTooMany",
  },
  {
    message: "Relay returned a malformed channel public key",
    key: "dapps:relayChannelKey",
  },
  {
    message: "Relay returned a malformed termination status",
    key: "dapps:relayStatus",
  },
  {
    message: "Socket connection cancelled",
    key: "dapps:socketCancelled",
  },
  {
    message: "Socket connect timeout",
    key: "dapps:socketTimeout",
  },
  {
    message: "qrUri: empty URI",
    key: "dapps:uriEmpty",
  },
  {
    message: "qrUri: malformed URI",
    key: "dapps:uriMalformed",
  },
  {
    message: "qrUri: not a qrlconnect URI",
    key: "dapps:uriScheme",
  },
  {
    message: "qrUri: invalid relay URL",
    key: "dapps:uriRelay",
  },
  {
    message: "qrUri: legacy v1 URI - this wallet requires a PQP3 dApp",
    key: "dapps:uriLegacy",
  },
  {
    message: "qrUri: unknown query parameter",
    key: "dapps:uriQuery",
  },
  {
    message: "qrUri: duplicate q parameter",
    key: "dapps:uriDuplicateQ",
  },
  {
    message: "qrUri: duplicate r parameter",
    key: "dapps:uriDuplicateR",
  },
  {
    message: "qrUri: missing q parameter",
    key: "dapps:uriMissingQ",
  },
  {
    message: "qrUri: bad PQP3 magic",
    key: "dapps:uriMagic",
  },
  {
    message: "qrUri: WebCrypto SubtleCrypto is not available",
    key: "dapps:uriCrypto",
  },
  {
    message: "base45: invalid input length",
    key: "dapps:base45Length",
  },
  {
    message: "base45: invalid character",
    key: "dapps:base45Character",
  },
  {
    message: "base45: decoded group exceeds 0xFFFF",
    key: "dapps:base45Group",
  },
  {
    message: "base45: decoded byte exceeds 0xFF",
    key: "dapps:base45Byte",
  },
  {
    message: "Failed to unlock the seed. Please try again.",
    key: "transfer:unlockFailed",
  },
  {
    message: "Another PIN check is still running. Please try again.",
    key: "settings:pinBusy",
  },
  {
    message: "Invalid input",
    key: "dapps:schemaInvalid",
  },
  {
    message: "Invalid key in record",
    key: "dapps:schemaRecordKey",
  },
  {
    message: "must be a valid QIP-55 Q-prefixed 64-byte address",
    key: "dapps:validAddress",
  },
  {
    message: "must be 0x-prefixed even-length hex bytes",
    key: "dapps:validHex",
  },
  {
    message: "field name required",
    key: "dapps:fieldNameRequired",
  },
  {
    message: "field type required",
    key: "dapps:fieldTypeRequired",
  },
  {
    message: "struct must have ≥1 field",
    key: "dapps:structFieldRequired",
  },
  {
    message: "invalid typed data payload",
    key: "dapps:invalidPayload",
  },
  {
    message: "typed data payload contains unknown top-level fields",
    key: "dapps:unknownTopFields",
  },
  {
    message: "typed data types must be a struct map",
    key: "dapps:typesMap",
  },
  {
    message: "typed data primaryType must be a string",
    key: "dapps:primaryString",
  },
  {
    message: "typed data domain must be an object",
    key: "dapps:domainObject",
  },
  {
    message: "typed data message must be an object",
    key: "dapps:messageObject",
  },
  {
    message: "typed data contains too many encoded values",
    key: "dapps:tooManyValues",
  },
  {
    message: "typed data contains too many fields",
    key: "dapps:tooManyFields",
  },
  {
    message: "typed data object contains too many fields",
    key: "dapps:objectFields",
  },
  {
    message: "qrl_signTypedData v1 does not support QIP-55 address fields",
    key: "dapps:v1Address",
  },
  {
    message: "string field exceeds typed data byte limit",
    key: "dapps:stringLimit",
  },
  {
    message: "bytes field exceeds typed data byte limit",
    key: "dapps:bytesLimit",
  },
  {
    message: "QRLDomain type is required",
    key: "dapps:domainRequired",
  },
  {
    message: "QRLDomain.name is required",
    key: "dapps:domainNameRequired",
  },
  {
    message: "QRLDomain cannot be the primary type",
    key: "dapps:domainPrimary",
  },
  {
    message: "Relay join acknowledgement timeout",
    key: "dapps:relayJoinTimeout",
  },
  {
    message: "Failed to join channel",
    key: "dapps:relayJoinFailed",
  },
  {
    message: "Relay send acknowledgement timeout",
    key: "dapps:relaySendTimeout",
  },
  {
    message: "Failed to send",
    key: "dapps:relaySendFailed",
  },
  {
    message: "Socket not connected",
    key: "dapps:socketDisconnected",
  },
  {
    message: "Relay channel not joined",
    key: "dapps:relayNotJoined",
  },
  {
    message: "KeyExchange: handshake generation changed",
    key: "dapps:handshakeChanged",
  },
  {
    message: "PQCrypto: WebCrypto SubtleCrypto is not available",
    key: "dapps:pqCryptoUnavailable",
  },
  {
    message: "qrUri: URI exceeds 4096 characters",
    key: "dapps:uriTooLong",
    values: {
      limit: 4096,
    },
  },
  {
    message: "qrUri: PQP3 payload exceeds 126 characters",
    key: "dapps:uriPayloadLong",
    values: {
      limit: 126,
    },
  },
  {
    message: "typed data must contain 1-32 struct types",
    key: "dapps:typeCount",
    values: {
      limit: 32,
    },
  },
  {
    message:
      "qrUri: legacy PQP1 URI - regenerate the QR with @qrlwallet/connect 4 or newer",
    key: "dapps:uriLegacyPqp",
    values: {
      version: "PQP1",
    },
  },
  {
    message:
      "qrUri: legacy PQP2 URI - regenerate the QR with @qrlwallet/connect 4 or newer",
    key: "dapps:uriLegacyPqp",
    values: {
      version: "PQP2",
    },
  },
  {
    message: "Incorrect PIN. 1 attempt remaining.",
    key: "settings:incorrectPin",
    values: {
      count: 1,
    },
  },
  {
    message: "Incorrect PIN. 2 attempts remaining.",
    key: "settings:incorrectPin",
    values: {
      count: 2,
    },
  },
  {
    message: "Incorrect PIN. 3 attempts remaining.",
    key: "settings:incorrectPin",
    values: {
      count: 3,
    },
  },
  {
    message: "Incorrect PIN. 4 attempts remaining.",
    key: "settings:incorrectPin",
    values: {
      count: 4,
    },
  },
  {
    message: "Too many failed attempts. Please wait 1 minute.",
    key: "settings:lockout",
    values: {
      count: 1,
    },
  },
  {
    message: "Too many failed attempts. Please wait 2 minutes.",
    key: "settings:lockout",
    values: {
      count: 2,
    },
  },
  {
    message: "Too many failed attempts. Please wait 3 minutes.",
    key: "settings:lockout",
    values: {
      count: 3,
    },
  },
  {
    message: "Too many failed attempts. Please wait 4 minutes.",
    key: "settings:lockout",
    values: {
      count: 4,
    },
  },
  {
    message: "Too many failed attempts. Please wait 5 minutes.",
    key: "settings:lockout",
    values: {
      count: 5,
    },
  },
  {
    message: "Too many failed attempts. Please wait 6 minutes.",
    key: "settings:lockout",
    values: {
      count: 6,
    },
  },
  {
    message: "Too many failed attempts. Please wait 7 minutes.",
    key: "settings:lockout",
    values: {
      count: 7,
    },
  },
  {
    message: "Too many failed attempts. Please wait 8 minutes.",
    key: "settings:lockout",
    values: {
      count: 8,
    },
  },
  {
    message: "Too many failed attempts. Please wait 9 minutes.",
    key: "settings:lockout",
    values: {
      count: 9,
    },
  },
  {
    message: "Too many failed attempts. Please wait 10 minutes.",
    key: "settings:lockout",
    values: {
      count: 10,
    },
  },
  {
    message: "Too many failed attempts. Please wait 11 minutes.",
    key: "settings:lockout",
    values: {
      count: 11,
    },
  },
  {
    message: "Too many failed attempts. Please wait 12 minutes.",
    key: "settings:lockout",
    values: {
      count: 12,
    },
  },
  {
    message: "Too many failed attempts. Please wait 13 minutes.",
    key: "settings:lockout",
    values: {
      count: 13,
    },
  },
  {
    message: "Too many failed attempts. Please wait 14 minutes.",
    key: "settings:lockout",
    values: {
      count: 14,
    },
  },
  {
    message: "Too many failed attempts. Please wait 15 minutes.",
    key: "settings:lockout",
    values: {
      count: 15,
    },
  },
];

// Each prefix is emitted by a known wallet producer. Its entire tail is opaque.
export const walletErrorWrappers: readonly WalletErrorWrapper[] = [
  {
    prefix: "Transaction signing failed: ",
    key: "dapps:transactionSigningFailed",
    variable: "reason",
  },
  {
    prefix: "Message signing failed: ",
    key: "dapps:messageSigningFailed",
    variable: "reason",
  },
  {
    prefix: "Typed data signing failed: ",
    key: "dapps:typedSigningFailed",
    variable: "reason",
  },
  {
    prefix: "Typed-data signing failed: ",
    key: "dapps:desktopTypedSigningFailed",
    variable: "reason",
  },
  {
    prefix: "Invalid qrl_signMessage params: ",
    key: "dapps:invalidMessageParams",
    variable: "reason",
  },
  {
    prefix: "Invalid qrl_signTypedData params: ",
    key: "dapps:invalidTypedParams",
    variable: "reason",
  },
  {
    prefix: "This transaction would fail on chain: ",
    key: "dapps:wouldRevertReason",
    variable: "reason",
  },
  {
    prefix: "qrUri: base45 decode failed: ",
    key: "dapps:uriBase45",
    variable: "reason",
  },
  {
    prefix: "Unrecognized key: ",
    key: "dapps:schemaUnrecognizedKey",
    variable: "keys",
  },
  {
    prefix: "Unrecognized keys: ",
    key: "dapps:schemaUnrecognizedKeys",
    variable: "keys",
  },
  {
    prefix: "field type too long: ",
    key: "dapps:fieldTypeLong",
    variable: "value",
  },
  {
    prefix: "invalid int width: ",
    key: "dapps:intWidth",
    variable: "value",
  },
  {
    prefix: "invalid bytesN width: ",
    key: "dapps:bytesWidth",
    variable: "value",
  },
  {
    prefix: "invalid array size: ",
    key: "dapps:arraySize",
    variable: "value",
  },
  {
    prefix: "unknown type: ",
    key: "dapps:unknownType",
    variable: "value",
  },
  {
    prefix: "unknown primary type: ",
    key: "dapps:unknownPrimary",
    variable: "value",
  },
  {
    prefix: "struct name is reserved by an atomic type: ",
    key: "dapps:reservedStruct",
    variable: "value",
  },
  {
    prefix: "empty or invalid struct: ",
    key: "dapps:invalidStruct",
    variable: "value",
  },
  {
    prefix: "bad field in ",
    key: "dapps:badField",
    variable: "value",
  },
  {
    prefix: "bad field type in ",
    key: "dapps:badFieldType",
    variable: "value",
  },
  {
    prefix: "encodeType: missing type definition for ",
    key: "dapps:missingType",
    variable: "value",
  },
  {
    prefix: "invalid Q-address: ",
    key: "dapps:invalidQAddress",
    variable: "value",
  },
  {
    prefix: "struct field expects object: ",
    key: "dapps:structObject",
    variable: "value",
  },
  {
    prefix: "address field expects string: ",
    key: "dapps:addressString",
    variable: "value",
  },
  {
    prefix: "bool field expects boolean: ",
    key: "dapps:boolBoolean",
    variable: "value",
  },
  {
    prefix: "string field expects string: ",
    key: "dapps:stringString",
    variable: "value",
  },
  {
    prefix: "bytes field expects 0x-hex string: ",
    key: "dapps:bytesHex",
    variable: "value",
  },
  {
    prefix: "array field expects array: ",
    key: "dapps:arrayArray",
    variable: "value",
  },
  {
    prefix: "unknown struct: ",
    key: "dapps:unknownStruct",
    variable: "value",
  },
  {
    prefix: "missing field ",
    key: "dapps:missingField",
    variable: "value",
  },
  {
    prefix: "unused referenced type: ",
    key: "dapps:unusedType",
    variable: "value",
  },
  {
    prefix: "invalid struct name: ",
    key: "dapps:invalidStructName",
    variable: "value",
  },
  {
    prefix: "invalid primary type: ",
    key: "dapps:invalidPrimary",
    variable: "value",
  },
];

/** Presentation only. Callers retain origin/dev's blank-message handling.
 * Full-string equality and a fixed prefix inventory bound comparisons per message.
 * Translate only the first wrapper; append its tail without passing it to i18next,
 * trimming it, matching it again, or truncating it.
 */
export function dappMessage(message: string, t: DAppTranslator): string {
  const known = walletErrorMessages.find((entry) => entry.message === message);
  if (known) return t(known.key, known.values ?? {});
  const wrapper = walletErrorWrappers.find(
    (entry) =>
      message.length > entry.prefix.length && message.startsWith(entry.prefix),
  );
  if (wrapper)
    return (
      t(wrapper.key, { reason: "", value: "", keys: "" }) +
      message.slice(wrapper.prefix.length)
    );
  return message;
}
