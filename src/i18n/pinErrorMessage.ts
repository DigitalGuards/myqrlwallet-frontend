import type { ParseKeys, TFunction } from "i18next";
import type { PinVerificationError } from "@/utils/crypto/verifyPinWithLimit";

export interface SettingsError {
  key: ParseKeys<["settings", "common"]>;
  count?: number;
}

/** Store meaning and count so an already visible error follows language changes. */
export function pinErrorMessage(error: PinVerificationError): SettingsError {
  if (error.isLocked)
    return {
      key: "settings:lockout",
      count: Math.ceil(error.remainingMs / 60000),
    };
  if (error.message === "Another PIN check is still running. Please try again.")
    return { key: "settings:pinBusy" };
  return { key: "settings:incorrectPin", count: error.attemptsLeft };
}

/** Zod stores stable message keys. Only this presentation boundary translates them. */
export function settingsValidationMessage(
  message: string | undefined,
  t: TFunction<["settings", "common"]>,
): string | undefined {
  switch (message) {
    case "settings:pinFormat":
      return t("settings:pinFormat");
    case "settings:pinMatch":
      return t("settings:pinMatch");
    case "settings:pinDifferent":
      return t("settings:pinDifferent");
    case "settings:passwordFormat":
      return t("settings:passwordFormat");
    case "settings:passwordMatch":
      return t("settings:passwordMatch");
    default:
      return undefined;
  }
}
