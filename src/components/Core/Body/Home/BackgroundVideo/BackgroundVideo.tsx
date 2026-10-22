import { useTranslation } from "react-i18next";
import { observer } from "mobx-react-lite";

const BackgroundVideo = observer(() => {
  const { t } = useTranslation("home");
  return (
    <img
      className="fixed left-0 top-0 z-0 h-96 w-96 -translate-x-8 scale-150 overflow-hidden opacity-10 pointer-events-none"
      src="/tree.svg"
      alt={t("backgroundTree")}
      fetchPriority="high"
      loading="eager"
    />
  );
});

export default BackgroundVideo;
