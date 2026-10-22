import { applyLanguage, i18n } from "../index";
import {
  assetMessage,
  assetServiceError,
  nftTransferFailure,
} from "../assetMessage";
import creation from "@/locales/en/creation.json";
import nfts from "@/locales/en/nfts.json";

afterEach(() => applyLanguage("en"));

it.each(["en", "de", "es", "ru", "zh-CN"] as const)(
  "%s translates every owned service guard and preserves external details",
  async (language) => {
    await applyLanguage(language);
    const t = i18n.getFixedT(null, [
      "creation",
      "nfts",
      "tokens",
      "home",
      "transfer",
      "settings",
      "onboarding",
      "common",
    ] as const);
    for (const key of [
      "walletChanged",
      "signingMismatch",
      "factoryMissing",
      "eventInvalid",
      "transactionFailed",
      "confirmationTimeout",
      "serviceFailed",
      "networkUnverified",
      "networkChanged",
      "accountChanged",
      "networkUnconfigured",
      "chainMismatch",
      "genesisMismatch",
      "mobileSigner",
      "extensionSigner",
      "feePolicy",
      "unknownError",
    ] as const) {
      const message = creation[key];
      const rendered = assetMessage(assetServiceError(message), t);
      expect(rendered).toBe(t(`creation:${key}`));
      if (language === "en") expect(rendered).toBe(message);
      else expect(rendered).not.toBe(message);
    }
    for (const key of ["walletChanged", "serviceFailed"] as const) {
      expect(assetMessage(assetServiceError(nfts[key]), t)).toBe(
        t(`nfts:${key}`),
      );
    }
    const address = `Q${"3".repeat(128)}`;
    expect(
      assetMessage(
        assetServiceError(
          `Factory contract not deployed at address: ${address}`,
        ),
        t,
      ),
    ).toBe(t("creation:factoryNotDeployed", { address }));
    for (const [reason, key] of [
      [creation.signingMismatch, "creation:signingMismatch"],
      [nfts.walletChanged, "nfts:walletChanged"],
      [creation.networkChanged, "creation:networkChanged"],
    ] as const) {
      expect(
        assetMessage(assetServiceError(`NFT transfer failed: ${reason}`), t),
      ).toBe(t("nfts:serviceReason", { reason: t(key) }));
    }
    for (const external of [
      "",
      "toString",
      "constructor",
      "__proto__",
      "nfts:wrongOwner",
      "{{reason}}",
      "$t(nfts:wrongOwner)",
      "Node <b>0xff</b>\nRPC detail",
    ]) {
      expect(assetMessage(assetServiceError(external), t)).toBe(external);
      expect(
        assetMessage(assetServiceError(`NFT transfer failed: ${external}`), t),
      ).toBe(t("nfts:serviceReason", { reason: external }));
    }
    expect(assetMessage(nftTransferFailure(null), t)).toBe(
      t("nfts:transferFailed"),
    );
    expect(assetMessage(nftTransferFailure(undefined), t)).toBe(
      t("nfts:transferFailed"),
    );
    expect(assetMessage(nftTransferFailure(""), t)).toBe("");
  },
);
