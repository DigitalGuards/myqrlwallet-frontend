import { readTransferError } from "./transferError";
import type { TFunction } from "i18next";

export type TransferTranslator = TFunction<["transfer", "common", "settings"]>;

/** Presentation adapter for shared services. Their data and error contracts stay unchanged.
 * Stable form keys and known service messages translate on every render; unknown
 * node/signer errors remain verbatim. Interpolated data is never used as a key.
 */
export function transferMessage(
  message: string | null | undefined,
  t: TransferTranslator,
): string | null {
  if (message === null || message === undefined) return null;
  const stored = readTransferError(message);
  if (stored)
    return t(stored.key, {
      count: stored.count,
      digits: stored.digits,
      reason: nestedReason(stored.reason ?? "", t),
    });
  switch (message) {
    case "Please select an asset":
    case "transfer:selectAssetRequired":
      return t("transfer:selectAssetRequired");
    case "Receiver address is required":
    case "transfer:receiverRequired":
      return t("transfer:receiverRequired");
    case "Enter a decimal amount":
    case "transfer:decimalAmount":
      return t("transfer:decimalAmount");
    case "Amount should be more than 0":
    case "transfer:positiveAmount":
      return t("transfer:positiveAmount");
    case "PIN must be between 4 to 6 digits":
    case "transfer:pinFormat":
      return t("transfer:pinFormat");
    case "Scanned QR does not contain a valid QRL address":
    case "transfer:invalidQr":
      return t("transfer:invalidQr");
    case "Recipient resolution changed. Verify the recipient again before signing.":
    case "transfer:recipientChanged":
      return t("transfer:recipientChanged");
    case "Enter a valid QRL address or a resolved QNS name.":
    case "transfer:validRecipient":
      return t("transfer:validRecipient");
    case "Unexpected transfer error.":
    case "transfer:unexpectedError":
      return t("transfer:unexpectedError");
    case "No stored seed found. Please import your account again.":
    case "transfer:noSeed":
      return t("transfer:noSeed");
    case "This wallet's device security credential is unavailable. Restore it on the original device or re-import the seed.":
    case "transfer:credentialUnavailable":
      return t("transfer:credentialUnavailable");
    case "Failed to unlock the seed. Please try again.":
    case "transfer:unlockFailed":
      return t("transfer:unlockFailed");
    case "Wallet not connected. Please try again.":
    case "transfer:notConnected":
      return t("transfer:notConnected");
    case "Security error: seed mismatch detected. Please re-import this account.":
    case "transfer:seedMismatch":
      return t("transfer:seedMismatch");
    case "PIN decrypted an invalid seed.":
    case "transfer:invalidSeed":
      return t("transfer:invalidSeed");
    case "Wallet changed while preparing the transaction":
    case "transfer:walletChanged":
      return t("transfer:walletChanged");
    case "Error: Wallet not connected":
    case "transfer:feeDisconnected":
      return t("transfer:feeDisconnected");
    case "Error: Invalid gas estimate":
    case "transfer:feeInvalid":
      return t("transfer:feeInvalid");
    case "Transaction failed. Please try again.":
    case "transfer:failedRetry":
      return t("transfer:failedRetry");
    case "Transaction execution failed. The transfer was reverted.":
    case "transfer:executionFailed":
      return t("transfer:executionFailed");
    case "The approval request timed out. Check your signer and History before retrying.":
    case "transfer:approvalTimeout":
      return t("transfer:approvalTimeout");
    case "The approval request was cancelled.":
    case "transfer:approvalCancelled":
      return t("transfer:approvalCancelled");
    case "The transaction was declined or the approval request was closed in your signer.":
    case "transfer:approvalDeclined":
      return t("transfer:approvalDeclined");
    case "Still waiting for confirmation after 5 minutes. Check History or the explorer before sending again.":
    case "transfer:confirmationTimeout":
      return t("transfer:confirmationTimeout");
    case "Recipient is not a supported QNS name.":
    case "transfer:nameUnsupported":
      return t("transfer:nameUnsupported");
    case "QNS hashing accepts only ASCII input":
    case "transfer:nameAscii":
      return t("transfer:nameAscii");
    case "Invalid QNS character":
    case "transfer:nameCharacter":
      return t("transfer:nameCharacter");
    case "QNS names may contain only ASCII letters, digits, hyphens, and dots":
    case "transfer:nameCharacters":
      return t("transfer:nameCharacters");
    case "QRNS recipient names must end in .qrl.":
    case "transfer:nameSuffix":
      return t("transfer:nameSuffix");
    case "Invalid QNS label":
    case "transfer:nameLabel":
      return t("transfer:nameLabel");
    case "QRNS has no provider for the selected network.":
    case "transfer:nameNoProvider":
      return t("transfer:nameNoProvider");
    case "QRNS is unavailable until a wallet network is selected.":
    case "transfer:nameNoNetwork":
      return t("transfer:nameNoNetwork");
    case "QRNS RPC returned an invalid response":
    case "transfer:nameRpcInvalid":
      return t("transfer:nameRpcInvalid");
    case "QRNS RPC response has no result":
    case "transfer:nameRpcNoResult":
      return t("transfer:nameRpcNoResult");
    case "QRNS RPC request timed out":
    case "transfer:nameRpcTimeout":
      return t("transfer:nameRpcTimeout");
    case "QRNS returned a malformed 64-byte address":
    case "transfer:nameMalformedAddress":
      return t("transfer:nameMalformedAddress");
    case "QRNS returned an invalid QIP-55 address":
    case "transfer:nameInvalidAddress":
      return t("transfer:nameInvalidAddress");
    case "Recipient address verified.":
    case "transfer:recipientVerified":
      return t("transfer:recipientVerified");
    case "Recipient is not a valid QRL address.":
    case "transfer:recipientInvalid":
      return t("transfer:recipientInvalid");
    case "Another PIN check is still running. Please try again.":
      return t("settings:pinBusy");
  }
  const decimals = /^Enter an amount with at most (\d+) decimal places$/.exec(
    message,
  );
  if (decimals)
    return t("transfer:decimals", {
      count: Number(decimals[1]),
      digits: decimals[1],
    });
  const attempts = /^Incorrect PIN\. (\d+) attempts? remaining\.$/.exec(
    message,
  );
  if (attempts)
    return t("settings:incorrectPin", { count: Number(attempts[1]) });
  const lockout =
    /^Too many failed attempts\. Please wait (\d+) minutes?\.$/.exec(message);
  if (lockout) return t("settings:lockout", { count: Number(lockout[1]) });
  const transactionFailed = /^Transaction failed: ([\s\S]*)$/.exec(message);
  if (transactionFailed)
    return t("transfer:transactionFailed", {
      reason: nestedReason(transactionFailed[1] ?? "", t),
    });
  const transferFailed = /^Transfer failed: ([\s\S]*)$/.exec(message);
  if (transferFailed)
    return t("transfer:transferFailed", {
      reason: nestedReason(transferFailed[1] ?? "", t),
    });
  const reverted = /^Transaction reverted: ([\s\S]*)$/.exec(message);
  if (reverted) return t("transfer:reverted", { reason: reverted[1] ?? "" });
  const confirmationUnavailable =
    /^Confirmation is unavailable: ([\s\S]*) Check History or the explorer before sending again\.$/.exec(
      message,
    );
  if (confirmationUnavailable)
    return t("transfer:confirmationUnavailable", {
      reason: confirmationUnavailable[1] ?? "",
    });
  const nameEmptyLabel = /^Empty label in "([\s\S]*)"$/.exec(message);
  if (nameEmptyLabel)
    return t("transfer:nameEmptyLabel", { name: nameEmptyLabel[1] ?? "" });
  const nameReserved = /^Reserved double-hyphen label in "([\s\S]*)"$/.exec(
    message,
  );
  if (nameReserved)
    return t("transfer:nameReserved", { name: nameReserved[1] ?? "" });
  const nameNoConfig = /^QRNS is not configured for (.*)\.$/.exec(message);
  if (nameNoConfig)
    return t("transfer:nameNoConfig", { network: nameNoConfig[1] ?? "" });
  const nameInvalidConfig =
    /^QRNS configuration for (.*) is incomplete or invalid\.$/.exec(message);
  if (nameInvalidConfig)
    return t("transfer:nameInvalidConfig", {
      network: nameInvalidConfig[1] ?? "",
    });
  const nameNoAddress = /^No native QRL address is set for (.*)\.$/.exec(
    message,
  );
  if (nameNoAddress)
    return t("transfer:nameNoAddress", { name: nameNoAddress[1] ?? "" });
  const nameResolved = /^(.*) resolved successfully\.$/.exec(message);
  if (nameResolved)
    return t("transfer:nameResolved", { name: nameResolved[1] ?? "" });
  const nameFailed = /^Unable to resolve (.*)\.$/.exec(message);
  if (nameFailed)
    return t("transfer:nameFailed", { name: nameFailed[1] ?? "" });
  const nameChainMismatch =
    /^QRNS is unavailable because the RPC chain does not match (.*)\.$/.exec(
      message,
    );
  if (nameChainMismatch)
    return t("transfer:nameChainMismatch", {
      network: nameChainMismatch[1] ?? "",
    });
  const nameGenesisMismatch =
    /^QRNS is unavailable because the RPC genesis does not match (.*)\.$/.exec(
      message,
    );
  if (nameGenesisMismatch)
    return t("transfer:nameGenesisMismatch", {
      network: nameGenesisMismatch[1] ?? "",
    });
  const nameRegistryMissing =
    /^QRNS is unavailable because its registry is not deployed on (.*)\.$/.exec(
      message,
    );
  if (nameRegistryMissing)
    return t("transfer:nameRegistryMissing", {
      network: nameRegistryMissing[1] ?? "",
    });
  const nameRpcHttp = /^QRNS RPC returned HTTP (\d+)$/.exec(message);
  if (nameRpcHttp)
    return t("transfer:nameRpcHttp", { status: nameRpcHttp[1] ?? "" });
  const resolving = /^Resolving (.*) on (.*)\.$/.exec(message);
  if (resolving)
    return t("transfer:nameResolving", {
      name: resolving[1],
      network: resolving[2],
    });
  return message;
}

function nestedReason(reason: string, t: TransferTranslator): string {
  if (reason === "transfer:unexpectedError")
    return t("transfer:unexpectedError");
  if (reason === "Wallet changed while preparing the transaction")
    return t("transfer:walletChanged");
  return reason;
}
