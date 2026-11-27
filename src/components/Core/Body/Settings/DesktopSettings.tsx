import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ExternalLink } from "lucide-react";
import { PageShell } from "@/components/Core/Layout/PageShell";
import { desktopSigner } from "@/desktop/bridge";
import { logger } from "@/utils/log";
import { LanguageSettings } from "./LanguageSettings";
import { SettingsRow, SettingsSection } from "./SettingsList";
import { ThemeSettings } from "./ThemeSettings";

export default function DesktopSettings() {
  const { t } = useTranslation(["settings", "common"]);
  const [failed, setFailed] = useState(false);

  const openSecuritySettings = () => {
    setFailed(false);
    void desktopSigner.openDesktopSettings().catch((error: unknown) => {
      logger.error("Failed to open desktop security settings:", error);
      setFailed(true);
    });
  };

  return (
    <PageShell title={t("common:settings")} seoTitle={t("common:settings")}>
      <div className="settings-plain space-y-7">
        <SettingsSection title={t("preferences")}>
          <LanguageSettings />
          <ThemeSettings />
        </SettingsSection>
        <SettingsSection title={t("security")}>
          <SettingsRow
            title={t("desktopSecurity")}
            subtitle={t("desktopSecurityHint")}
            right={
              <ExternalLink className="h-4 w-4 shrink-0" aria-hidden="true" />
            }
            onClick={openSecuritySettings}
          />
          {failed && (
            <p role="alert" className="py-3 text-sm text-destructive">
              {t("desktopSecurityError")}
            </p>
          )}
        </SettingsSection>
      </div>
    </PageShell>
  );
}
