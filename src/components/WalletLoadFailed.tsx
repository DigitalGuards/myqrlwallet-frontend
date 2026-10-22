import { useTranslation } from "react-i18next";
/**
 * Rendered by main.tsx when the wallet code fails to load, so the visitor
 * sees what happened and how to recover.
 */
import { useLanguagePreference } from "@/i18n/useLanguagePreference";

const WalletLoadFailed = () => {
  useLanguagePreference();
  const { t } = useTranslation("notices");
  return (
    <main className="p-8">
      <h1>{t("loadFailed")}</h1>
      <p>{t("reload")}</p>
    </main>
  );
};

export default WalletLoadFailed;
