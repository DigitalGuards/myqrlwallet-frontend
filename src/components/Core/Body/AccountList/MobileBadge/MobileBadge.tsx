import { useTranslation } from "react-i18next";
export const MobileBadge = () => {
  const { t } = useTranslation("accounts");
  return (
  <span className="w-fit mx-auto md:mx-0 rounded px-2 py-0.5 text-[10px] font-semibold uppercase bg-emerald-800/30 text-emerald-400">
    {t("mobile")}
  </span>
);
};
