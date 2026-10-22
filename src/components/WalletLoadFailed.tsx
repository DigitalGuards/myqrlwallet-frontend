import { useBootNoticeTranslation } from "@/i18n/useBootNoticeTranslation";
/**
 * Rendered by main.tsx when the wallet code fails to load, so the visitor
 * sees what happened and how to recover.
 */
const WalletLoadFailed = () => {
  const t = useBootNoticeTranslation();
  return (
    <main className="p-8">
      <h1>{t("loadFailed")}</h1>
      <p>{t("reload")}</p>
    </main>
  );
};

export default WalletLoadFailed;
