import { useTranslation } from "react-i18next";
/**
 * Shown by the hosted build when it is opened inside an app version that
 * loaded qrlwallet.com over the network. Current app versions ship the wallet
 * inside the app, so the hosted page never has a native bridge to talk to.
 * See `isRetiredNativeApp`.
 */
import { useLanguagePreference } from "@/i18n/useLanguagePreference";

const RetiredAppNotice = () => {
  useLanguagePreference();
  const { t } = useTranslation("notices");
  return (
    <main className="p-8">
      <h1>{t("update")}</h1>
      <p>{t("retired")}</p>
      <p>{t("regularBrowser")}</p>
      <p>
        <a href="https://play.google.com/store/apps/details?id=com.chiefdg.myqrlwallet">
          Google Play
        </a>
        {" | "}
        <a href="https://myqrlwallet.com">myqrlwallet.com</a>
      </p>
    </main>
  );
};

export default RetiredAppNotice;
