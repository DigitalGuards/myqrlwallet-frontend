import { useTranslation } from "react-i18next";
export const ExtensionBadge = () => {
  const { t } = useTranslation("accounts");
  return (
  <span className="w-fit mx-auto md:mx-0 rounded px-2 py-0.5 text-[10px] font-semibold uppercase bg-identity-accent/15 text-identity-accent">
    {t("extension")}
  </span>
);
};
