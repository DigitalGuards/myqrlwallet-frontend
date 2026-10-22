import type { TFunction } from "i18next";

/** Preserve configured identities while localizing the built-in display names. */
export function networkName(name: string, t: TFunction): string {
  switch (name) {
    case "QRL 2.0 Mainnet":
      return t("mainnetFull");
    case "QRL 2.0 Testnet":
      return t("testnetFull");
    case "QRL Testnet v3 (Private)":
      return t("testnetV3");
    default:
      return name;
  }
}
