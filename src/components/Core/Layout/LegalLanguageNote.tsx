import { useTranslation } from "react-i18next";

/** Owner policy: legal content remains English in every UI language. */
export function LegalLanguageNote() {
  const { t, i18n } = useTranslation("common");
  if (i18n.resolvedLanguage === "en") return null;
  return (
    <p className="mb-4 text-sm text-muted-foreground">{t("englishOnly")}</p>
  );
}
