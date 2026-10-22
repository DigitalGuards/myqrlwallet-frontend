import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronRight, Shield } from "lucide-react";
import { isDesktop, desktopSigner } from "@/desktop/bridge";
import { isInNativeApp, openNativeSettings } from "@/utils/nativeApp";
import { SettingsRow, SettingsSection } from "./SettingsList";

export function DeviceSettings() {
  const { t } = useTranslation("settings");
  const [failed, setFailed] = useState(false);
  if (!isDesktop && !isInNativeApp()) return null;
  const open = async () => {
    setFailed(false);
    try {
      if (isInNativeApp()) openNativeSettings();
      else await desktopSigner.openDesktopSettings();
    } catch {
      setFailed(true);
    }
  };
  return (
    <SettingsSection title={t("security")}>
      <SettingsRow
        icon={Shield}
        tint="bg-primary/15 text-primary"
        title={t("nativeSettings")}
        subtitle={t("nativeSettingsHint")}
        right={<ChevronRight className="h-4 w-4 shrink-0" />}
        onClick={() => {
          void open();
        }}
      />
      {failed && (
        <p role="alert" className="p-4 text-sm text-destructive">
          {t("nativeSettingsError")}
        </p>
      )}
    </SettingsSection>
  );
}
