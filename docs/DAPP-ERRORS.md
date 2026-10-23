# dApp display error inventory

Audited against the pairing and approval producers at base `b7a0fac72ace1f3c393c6335499df1fd1d1c0366`. The presentation adapter is [dappMessage.ts](../src/i18n/dappMessage.ts). Services, stores, signing, protocol replies and the visibility gate retain their existing behavior.

## Display rule

The adapter compares the complete input with the 120 strings below using full-string equality. Failing that, it checks the 33 literal wallet prefixes below, in order, requiring a nonempty remainder. It translates one prefix and appends the complete remainder verbatim. A second wrapper, a known literal, HTML-looking text and interpolation-looking text in that remainder all remain data. The remainder never enters i18next. Unknown inputs are returned unchanged.

There are at most 120 full-string comparisons and 33 prefix checks per call, independent of message length or nesting. There is no recursive call, regular expression, numeric extraction, substring search, case folding or new truncation. String copying and browser rendering still take space and time proportional to the text being displayed.

The caller's base behavior is preserved: consent tests `error?.trim()` only to select the blank-error fallback, then displays the original nonblank string. Approval's existing `formatDAppRequestError` supplies the blank fallback and circular/deep-type display sentences. The adapter adds no trimming. Existing desktop bridge first-line handling, encoder previews and service-side relay acknowledgement bounds remain at their original producers.

## Producer audit

| Producer and route | Coverage and boundary |
| --- | --- |
| `stores/dappConnectStore.ts:confirmDesktopConnect` and consent | `No pending connection` and `Connection failed` are exact entries. Service result errors pass unchanged to the adapter. |
| `services/dappConnect/DAppConnectService.ts:handleConnectionURI`, `duplicateConnectionResult`, `assertEpochCurrent`, `validateBufferedMessages`, `decodeRelayPublicKey` | All locally returned identity, ownership, duplicate-QR, relay-list/key, terminated-channel, public-key-pending and fingerprint errors are exact entries below. The embedded relay restriction is also an exact entry; its pre-existing throw behavior is unchanged. The internal `non-canonical key` throw is caught and replaced by `Relay returned an invalid ML-KEM public key`. |
| `services/dappConnect/SocketClient.ts:connect`, `waitForConnect`, `parseJoinResponse`, `emitJoinChannel` | Socket cancellation/timeout, five malformed join-response errors, `Relay join acknowledgement timeout` and `Failed to join channel` are exact entries. Socket.IO `connect_error` strings and usable relay-provided acknowledgement errors are external data; they receive only the same exact-list/one-prefix treatment. The existing 256-character acknowledgement-error check remains in the service; connect errors have no added bound. |
| `SocketClient.ts:sendMessage`, awaited for the initial SYNACK | `Socket not connected`, `Relay channel not joined`, `Relay send acknowledgement timeout` and `Failed to send` are exact entries. Relay-supplied `Sender not in channel` / `Channel not found` and all other relay diagnostics stay verbatim unless they exactly equal a listed string or start with a listed wallet prefix. |
| `services/dappConnect/qrUri.ts:parseConnectionURI`, `computeFingerprint`; `base45.ts` | All fixed parser errors, the two legacy PQP strings and the actual fixed limits (4096 URI characters, 126 PQP3 payload characters) are exact entries. `qrUri: base45 decode failed: ` is a single wrapper: its base45 reason remains English/verbatim even if it equals a listed base45 error. The variable-length `qrUri: expected 84-byte blob, got N` diagnostic stays verbatim. No numeric pattern is translated. |
| `services/dappConnect/KeyExchange.ts:receiveQR`; `PQCrypto.ts` | The async `KeyExchange: handshake generation changed` cancellation and both qrUri/PQCrypto WebCrypto-unavailable diagnostics are exact entries. Library/WebCrypto exceptions remain external details. Fixed-size guards are listed separately below. |
| `DAppApprovalModal.tsx`, `requestError.ts`, `desktop/bridge.ts:desktopSigningError` | PIN/account/seed/signer guards, request/connection fallbacks, the circular/deep-type display sentences, desktop fallbacks and all five `toUserFacingError` outcomes are exact entries. Four signing failure wrappers and two invalid-params wrappers translate only their first prefix. A stored-seed or desktop-signer mismatch inside a wrapper remains part of its opaque tail. Desktop scheme mismatch text stays verbatim in that tail. |
| `dappRevertPrecheck.ts`, `dappBroadcastOutcome.ts`, transaction progress in the approval modal | The no-reason revert, unavailable/unconfirmed confirmation, already-queued and unknown-acceptance sentences are exact entries. `This transaction would fail on chain: ` translates only the prefix and preserves the contract/node reason. Existing receipt/RPC outcome classification is unchanged. |
| `utils/crypto/verifyPinWithLimit.ts`, `pinAttemptTracker.ts` | Busy and unlock-failed messages are exact entries. The four normal remaining-attempt messages and fifteen normal lockout-minute messages are individually enumerated. Unlisted counts, including longer lockouts after clock rollback, remain verbatim. No counts are parsed from error text. Device-credential failure is converted to the exact entry by the existing unlock helper. |
| `utils/signing/types.ts` and locally produced Zod issues | All five custom schema messages and the two fixed Zod messages `Invalid input` / `Invalid key in record` are exact entries. `Unrecognized key: ` and `Unrecognized keys: ` are single prefixes. Expected/received-type and length-bound diagnostics remain verbatim. Structured issue paths retain their existing display representation. |
| `utils/signing/typedData.ts` | All fixed encoder literals previously covered remain exact entries, including the actual 1-32 type bound. The 23 encoder prefixes below preserve everything after the first prefix. Dynamic multi-part encoder diagnostics are listed below and remain verbatim. Existing circular/deep-type normalization happens in the base formatter before translation. |
| `rpcProvider.ts`, `dappTransaction.ts`, `dappBroadcastSettlement.ts` and other transaction dependencies | Chain/provider errors (`Wallet RPC returned an invalid chain id`, `Web3 request provider unavailable`, `Transaction chain does not match the wallet network`), transaction data/to/value type guards, `Invalid transaction event source`, `Wallet changed while verifying the transaction chain`, `Wallet not connected` and desktop raw-transaction guards enter existing generic transaction/fee/network failure presentation. Their exposed fixed outcome sentences or direct UI keys are translated; the raw internal strings are not added to the inventory. |

### Remaining diagnostic families

These wallet-generated encoder diagnostics retain the complete base string: `duplicate field "F" in T`, `invalid field name in T: F`, `unknown field in T: F`; signed/unsigned integer range, negative, length, invalid-string, unsafe-number and unsupported-value errors; bytesN input/required/actual-length errors; array/fixed-array size errors; QRLDomain reserved-field/type errors; `cannot pad: bytes > N`; and `the desktop signer used X, the payload requires Y`. If an outer listed wrapper exists, only that wrapper translates. The caller's existing circular/deep-type formatter is unchanged.

The following defensive guards are outside the normal consent result path and remain unlisted: `A different relay channel join is already in progress`, `Socket not initialised; call connect() before joinChannel()`; qrUri cid/cap length and cid conversion guards; KeyExchange cid/public-key/capability lengths and already-established-session guard; PQCrypto cid/public-key/ciphertext/capability/shared-secret/transcript-hash/key/direction lengths. Pairing validates parser and relay lengths before creating a fresh KeyExchange and connecting its socket. A future path exposing one of these strings will render it verbatim until explicitly added.

KeyExchange ACK verification, persisted-session decoding, established-session counters, SessionStore checkpoint failures, metadata validation and RequestHandler/protocol method/authorization errors run in background handlers, reconnect or protocol replies. They do not return through the consent result or approval error state. They are outside this display inventory. Signing byte-helper guards (`hex must be a string`, `hex must be 0x-prefixed even-length`, `bytes must be a Uint8Array`, `messageBytes must be a Uint8Array`) are prevented by the existing schema/encoder call contracts; if raised, an existing outer signing wrapper preserves them.

## Closed list (120 full strings)

Each row translates only on full equality. The key records the reviewed translation and its translator note. PIN counts, protocol versions and fixed limits are literal entries with fixed interpolation values.

| Full string | Translation key |
| --- | --- |
| `User rejected the request` | `dapps:desktopRejected` |
| `Desktop signing failed` | `dapps:desktopSigningFailed` |
| `Connection failed` | `dapps:connectionFailed` |
| `The request failed.` | `dapps:requestFailed` |
| `Typed data contains a circular type reference.` | `dapps:circularType` |
| `Typed data is nested too deeply.` | `dapps:deepType` |
| `Insufficient funds for this transaction.` | `dapps:insufficientFunds` |
| `Transaction nonce is too low. Please retry.` | `dapps:nonceLow` |
| `This transaction was already submitted.` | `dapps:alreadySubmitted` |
| `Request was rejected.` | `dapps:requestRejected` |
| `Transaction failed. Please verify details and try again.` | `dapps:transactionFailed` |
| `Please enter your PIN` | `dapps:pinRequired` |
| `Wallet changed while preparing the request` | `dapps:walletChanged` |
| `No encrypted seed found` | `dapps:noSeed` |
| `Wallet device security credential unavailable; re-import the seed` | `dapps:credentialUnavailable` |
| `No active account` | `dapps:noAccount` |
| `Signer mismatch: request is for a different account` | `dapps:signerMismatch` |
| `Web3 not initialized` | `dapps:web3Unavailable` |
| `Failed to sign transaction` | `dapps:signFailed` |
| `Transaction has been reverted by the QRVM` | `dapps:revertedQrvm` |
| `Transaction status is unavailable.` | `dapps:statusUnavailable` |
| `Transaction was broadcast, but confirmation is unavailable. Check the explorer before sending again.` | `dapps:broadcastUnconfirmed` |
| `Transaction confirmation is unavailable. Check the explorer before sending again.` | `dapps:confirmationUnavailable` |
| `This transaction is already in the network queue. Check the explorer before sending it again.` | `dapps:alreadyQueued` |
| `The network did not confirm whether this transaction was accepted. Check the explorer before sending it again.` | `dapps:broadcastUnknown` |
| `This transaction would fail on chain, so it was not sent.` | `dapps:wouldRevert` |
| `the stored seed does not match the requested signer` | `dapps:storedSignerMismatch` |
| `the desktop signer does not match the requested signer` | `dapps:desktopSignerMismatch` |
| `No pending connection` | `dapps:noPending` |
| `Wallet identity is changing; retry the connection` | `dapps:identityChanging` |
| `Wallet identity changed during QRL Connect operation` | `dapps:identityChanged` |
| `Wallet identity changed while reading the connection` | `dapps:identityReading` |
| `Wallet identity changed while opening the connection` | `dapps:identityOpening` |
| `This QRL Connect session is active in another wallet tab, or this browser cannot safely lock it` | `dapps:sessionLocked` |
| `This wallet pairs only through the qrlwallet.com relay. Ask the dApp to use it, or pair from the web wallet.` | `dapps:relayRestricted` |
| `dApp has not registered its public key with the relay yet; retry the scan` | `dapps:publicKeyPending` |
| `Relay-provided public key does not match the fingerprint from the QR` | `dapps:fingerprintMismatch` |
| `Previous wallet connection is still being cleared` | `dapps:clearingConnection` |
| `Scanned QR does not match the already-connected dApp for this channel` | `dapps:qrMismatch` |
| `Relay returned an invalid buffered message list` | `dapps:relayList` |
| `Relay returned a malformed buffered message` | `dapps:relayMessage` |
| `Relay returned an invalid ML-KEM public key` | `dapps:relayKey` |
| `Relay reported a terminated or malformed channel` | `dapps:relayTerminated` |
| `Relay returned malformed buffered messages` | `dapps:relayMessages` |
| `Relay returned too many buffered messages` | `dapps:relayTooMany` |
| `Relay returned a malformed channel public key` | `dapps:relayChannelKey` |
| `Relay returned a malformed termination status` | `dapps:relayStatus` |
| `Socket connection cancelled` | `dapps:socketCancelled` |
| `Socket connect timeout` | `dapps:socketTimeout` |
| `qrUri: empty URI` | `dapps:uriEmpty` |
| `qrUri: malformed URI` | `dapps:uriMalformed` |
| `qrUri: not a qrlconnect URI` | `dapps:uriScheme` |
| `qrUri: invalid relay URL` | `dapps:uriRelay` |
| `qrUri: legacy v1 URI - this wallet requires a PQP3 dApp` | `dapps:uriLegacy` |
| `qrUri: unknown query parameter` | `dapps:uriQuery` |
| `qrUri: duplicate q parameter` | `dapps:uriDuplicateQ` |
| `qrUri: duplicate r parameter` | `dapps:uriDuplicateR` |
| `qrUri: missing q parameter` | `dapps:uriMissingQ` |
| `qrUri: bad PQP3 magic` | `dapps:uriMagic` |
| `qrUri: WebCrypto SubtleCrypto is not available` | `dapps:uriCrypto` |
| `base45: invalid input length` | `dapps:base45Length` |
| `base45: invalid character` | `dapps:base45Character` |
| `base45: decoded group exceeds 0xFFFF` | `dapps:base45Group` |
| `base45: decoded byte exceeds 0xFF` | `dapps:base45Byte` |
| `Failed to unlock the seed. Please try again.` | `transfer:unlockFailed` |
| `Another PIN check is still running. Please try again.` | `settings:pinBusy` |
| `Invalid input` | `dapps:schemaInvalid` |
| `Invalid key in record` | `dapps:schemaRecordKey` |
| `must be a valid QIP-55 Q-prefixed 64-byte address` | `dapps:validAddress` |
| `must be 0x-prefixed even-length hex bytes` | `dapps:validHex` |
| `field name required` | `dapps:fieldNameRequired` |
| `field type required` | `dapps:fieldTypeRequired` |
| `struct must have ≥1 field` | `dapps:structFieldRequired` |
| `invalid typed data payload` | `dapps:invalidPayload` |
| `typed data payload contains unknown top-level fields` | `dapps:unknownTopFields` |
| `typed data types must be a struct map` | `dapps:typesMap` |
| `typed data primaryType must be a string` | `dapps:primaryString` |
| `typed data domain must be an object` | `dapps:domainObject` |
| `typed data message must be an object` | `dapps:messageObject` |
| `typed data contains too many encoded values` | `dapps:tooManyValues` |
| `typed data contains too many fields` | `dapps:tooManyFields` |
| `typed data object contains too many fields` | `dapps:objectFields` |
| `qrl_signTypedData v1 does not support QIP-55 address fields` | `dapps:v1Address` |
| `string field exceeds typed data byte limit` | `dapps:stringLimit` |
| `bytes field exceeds typed data byte limit` | `dapps:bytesLimit` |
| `QRLDomain type is required` | `dapps:domainRequired` |
| `QRLDomain.name is required` | `dapps:domainNameRequired` |
| `QRLDomain cannot be the primary type` | `dapps:domainPrimary` |
| `Relay join acknowledgement timeout` | `dapps:relayJoinTimeout` |
| `Failed to join channel` | `dapps:relayJoinFailed` |
| `Relay send acknowledgement timeout` | `dapps:relaySendTimeout` |
| `Failed to send` | `dapps:relaySendFailed` |
| `Socket not connected` | `dapps:socketDisconnected` |
| `Relay channel not joined` | `dapps:relayNotJoined` |
| `KeyExchange: handshake generation changed` | `dapps:handshakeChanged` |
| `PQCrypto: WebCrypto SubtleCrypto is not available` | `dapps:pqCryptoUnavailable` |
| `qrUri: URI exceeds 4096 characters` | `dapps:uriTooLong` |
| `qrUri: PQP3 payload exceeds 126 characters` | `dapps:uriPayloadLong` |
| `typed data must contain 1-32 struct types` | `dapps:typeCount` |
| `qrUri: legacy PQP1 URI - regenerate the QR with @qrlwallet/connect 4 or newer` | `dapps:uriLegacyPqp` |
| `qrUri: legacy PQP2 URI - regenerate the QR with @qrlwallet/connect 4 or newer` | `dapps:uriLegacyPqp` |
| `Incorrect PIN. 1 attempt remaining.` | `settings:incorrectPin` |
| `Incorrect PIN. 2 attempts remaining.` | `settings:incorrectPin` |
| `Incorrect PIN. 3 attempts remaining.` | `settings:incorrectPin` |
| `Incorrect PIN. 4 attempts remaining.` | `settings:incorrectPin` |
| `Too many failed attempts. Please wait 1 minute.` | `settings:lockout` |
| `Too many failed attempts. Please wait 2 minutes.` | `settings:lockout` |
| `Too many failed attempts. Please wait 3 minutes.` | `settings:lockout` |
| `Too many failed attempts. Please wait 4 minutes.` | `settings:lockout` |
| `Too many failed attempts. Please wait 5 minutes.` | `settings:lockout` |
| `Too many failed attempts. Please wait 6 minutes.` | `settings:lockout` |
| `Too many failed attempts. Please wait 7 minutes.` | `settings:lockout` |
| `Too many failed attempts. Please wait 8 minutes.` | `settings:lockout` |
| `Too many failed attempts. Please wait 9 minutes.` | `settings:lockout` |
| `Too many failed attempts. Please wait 10 minutes.` | `settings:lockout` |
| `Too many failed attempts. Please wait 11 minutes.` | `settings:lockout` |
| `Too many failed attempts. Please wait 12 minutes.` | `settings:lockout` |
| `Too many failed attempts. Please wait 13 minutes.` | `settings:lockout` |
| `Too many failed attempts. Please wait 14 minutes.` | `settings:lockout` |
| `Too many failed attempts. Please wait 15 minutes.` | `settings:lockout` |

## Closed wrapper list (33 prefixes)

Every prefix includes its final space, shown below inside code spans. At least one character must follow it. Translation templates retain their reason/value/keys placeholder at the end so only a wallet-owned prefix is passed to i18next.

| Literal prefix | Translation key |
| --- | --- |
| `Transaction signing failed: ` | `dapps:transactionSigningFailed` |
| `Message signing failed: ` | `dapps:messageSigningFailed` |
| `Typed data signing failed: ` | `dapps:typedSigningFailed` |
| `Typed-data signing failed: ` | `dapps:desktopTypedSigningFailed` |
| `Invalid qrl_signMessage params: ` | `dapps:invalidMessageParams` |
| `Invalid qrl_signTypedData params: ` | `dapps:invalidTypedParams` |
| `This transaction would fail on chain: ` | `dapps:wouldRevertReason` |
| `qrUri: base45 decode failed: ` | `dapps:uriBase45` |
| `Unrecognized key: ` | `dapps:schemaUnrecognizedKey` |
| `Unrecognized keys: ` | `dapps:schemaUnrecognizedKeys` |
| `field type too long: ` | `dapps:fieldTypeLong` |
| `invalid int width: ` | `dapps:intWidth` |
| `invalid bytesN width: ` | `dapps:bytesWidth` |
| `invalid array size: ` | `dapps:arraySize` |
| `unknown type: ` | `dapps:unknownType` |
| `unknown primary type: ` | `dapps:unknownPrimary` |
| `struct name is reserved by an atomic type: ` | `dapps:reservedStruct` |
| `empty or invalid struct: ` | `dapps:invalidStruct` |
| `bad field in ` | `dapps:badField` |
| `bad field type in ` | `dapps:badFieldType` |
| `encodeType: missing type definition for ` | `dapps:missingType` |
| `invalid Q-address: ` | `dapps:invalidQAddress` |
| `struct field expects object: ` | `dapps:structObject` |
| `address field expects string: ` | `dapps:addressString` |
| `bool field expects boolean: ` | `dapps:boolBoolean` |
| `string field expects string: ` | `dapps:stringString` |
| `bytes field expects 0x-hex string: ` | `dapps:bytesHex` |
| `array field expects array: ` | `dapps:arrayArray` |
| `unknown struct: ` | `dapps:unknownStruct` |
| `missing field ` | `dapps:missingField` |
| `unused referenced type: ` | `dapps:unusedType` |
| `invalid struct name: ` | `dapps:invalidStructName` |
| `invalid primary type: ` | `dapps:invalidPrimary` |

## Regression coverage

`dappMessage.origins.test.ts` checks every exact entry in all five languages, English byte equality, suffix/case/leading-text/whitespace look-alikes, every wrapper with an external tail or another wrapper, a known literal in a tail, interpolation-looking data, unmatched long messages and the 12,000-prefix attack. Existing parser/schema/encoder tests use actual producers and explicitly preserve the newly opaque multi-part diagnostics.

`slice6Language.test.tsx` reuses the review's consent renderer reproductions in every language: the relay diagnostic stays verbatim and the 288,020-character attack retains the consent dialog with its entire remainder. The existing 110 English snapshots remain unchanged.

`approval-relay-error-probes.mjs` runs through the actual SocketClient, service, store and consent modal in `smoke:approvals` for every language. It mocks only external network responses and supplies a synthetic active account. It covers the long Socket.IO connect error, the schema-shaped relay diagnostic, an unacknowledged join and an unsuccessful join acknowledgement without an error string. It asserts exact alert text, retained consent, actual socket/join traffic and no page errors; screenshots and JSON record all twenty cases. It performs no signing or broadcasting.
