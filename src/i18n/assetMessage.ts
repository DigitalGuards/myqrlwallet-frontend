import type { PinVerificationError } from "@/utils/crypto/verifyPinWithLimit";
import type { ParseKeys, TFunction } from "i18next";
import { i18n } from "./index";
import { transferMessage } from "./transferMessage";

type AssetNamespaces = [
  "creation",
  "nfts",
  "tokens",
  "home",
  "transfer",
  "settings",
  "onboarding",
  "common",
];
export type AssetKey = ParseKeys<AssetNamespaces>;
export type AssetMessage =
  | {
      key: AssetKey;
      count?: number;
      reason?: string;
      balance?: string;
      address?: string;
      reasonKey?: AssetKey;
    }
  | { external: string }
  | { recipient: string };

/** Keep local meaning in state and interpolate external details only at render time. */
export function assetMessage(
  message: AssetMessage | null,
  t: TFunction<AssetNamespaces>,
): string | undefined {
  if (!message) return undefined;
  if ("external" in message) return message.external;
  if ("recipient" in message)
    return (
      transferMessage(
        message.recipient,
        i18n.getFixedT(null, ["transfer", "common", "settings"]),
      ) ?? undefined
    );
  return t(message.key, {
    ...message,
    reason: message.reasonKey ? t(message.reasonKey) : message.reason,
  });
}

/** Shared store contracts remain English. Only wallet-owned messages are adapted. */
export function assetServiceError(message: string): AssetMessage {
  const sharedKey = Object.prototype.hasOwnProperty.call(
    sharedServiceKeys,
    message,
  )
    ? sharedServiceKeys[message]
    : undefined;
  if (sharedKey) return { key: sharedKey };
  switch (message) {
    case "Wallet changed while preparing token creation":
      return { key: "creation:walletChanged" };
    case "The signing seed does not match the active account":
      return { key: "creation:signingMismatch" };
    case "Factory contract address not configured. Please set VITE_CUSTOMERC20FACTORY_ADDRESS.":
      return { key: "creation:factoryMissing" };
    case "TokenCreated event signature is not a 32-byte hash":
      return { key: "creation:eventInvalid" };
    case "Transaction failed":
      return { key: "creation:transactionFailed" };
    case "Token creation confirmation timed out.":
      return { key: "creation:confirmationTimeout" };
    case "Token creation failed":
      return { key: "creation:serviceFailed" };
    case "Wallet changed while preparing the NFT transfer":
      return { key: "nfts:walletChanged" };
    case "NFT transfer failed":
      return { key: "nfts:serviceFailed" };
  }
  const factory = /^Factory contract not deployed at address: ([\s\S]*)$/.exec(
    message,
  );
  if (factory)
    return { key: "creation:factoryNotDeployed", address: factory[1] ?? "" };
  const nft = /^NFT transfer failed: ([\s\S]*)$/.exec(message);
  if (nft) {
    const reason = nft[1] ?? "";
    const reasonKey =
      (Object.prototype.hasOwnProperty.call(sharedServiceKeys, reason)
        ? sharedServiceKeys[reason]
        : undefined) ??
      (reason === "Wallet changed while preparing the NFT transfer"
        ? "nfts:walletChanged"
        : undefined) ??
      (reason === "The signing seed does not match the active account"
        ? "creation:signingMismatch"
        : undefined);
    return { key: "nfts:serviceReason", reason, reasonKey };
  }
  return { external: message };
}

/** React Hook Form stores the key; a language change never reruns validation. */
export function creationValidationMessage(
  message: string,
  t: TFunction<AssetNamespaces>,
): string {
  switch (message) {
    case "creation:nameRequired":
      return t("creation:nameRequired");
    case "creation:symbolRequired":
      return t("creation:symbolRequired");
    case "creation:decimalsRequired":
      return t("creation:decimalsRequired");
    case "creation:recipientInvalid":
      return t("creation:recipientInvalid");
    case "creation:profanity":
      return t("creation:profanity");
    default:
      return message;
  }
}

export function assetPinError(error: PinVerificationError): AssetMessage {
  if (error.isLocked)
    return {
      key: "settings:lockout",
      count: Math.ceil(error.remainingMs / 60000),
    };
  if (error.message === "Another PIN check is still running. Please try again.")
    return { key: "settings:pinBusy" };
  return { key: "settings:incorrectPin", count: error.attemptsLeft };
}

const sharedServiceKeys: Record<string, AssetKey> = {
  "Testnet v3 network identity has not been verified":
    "creation:networkUnverified",
  "Network changed during identity verification": "creation:networkChanged",
  "Account changed during identity verification": "creation:accountChanged",
  "Network identity is not configured": "creation:networkUnconfigured",
  "Testnet v3 chain identity mismatch": "creation:chainMismatch",
  "Testnet v3 genesis identity mismatch": "creation:genesisMismatch",
  "This account is signed by the paired mobile app. Confirm the transfer there.":
    "creation:mobileSigner",
  "This account is signed by the extension wallet. Confirm the transfer there.":
    "creation:extensionSigner",
  "The network fee quoted for this transaction is far above what this network normally charges, so the wallet stopped. Try again in a moment, and tell us if it keeps happening.":
    "creation:feePolicy",
  "Unknown error": "creation:unknownError",
};

export function nftTransferFailure(
  message: string | null | undefined,
): AssetMessage {
  return message === null || message === undefined
    ? { key: "nfts:transferFailed" }
    : assetServiceError(message);
}
