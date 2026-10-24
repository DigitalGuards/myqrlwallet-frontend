import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ExternalLink, Shield } from "lucide-react";
import { PageShell } from "@/components/Core/Layout/PageShell";
import { desktopSigner } from "@/desktop/bridge";
import { logger } from "@/utils/log";
import { LanguageSettings } from "./LanguageSettings";
import { SettingsRow, SettingsSection } from "./SettingsList";

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
      <div className="space-y-6">
        <SettingsSection title={t("preferences")}>
          <LanguageSettings />
        </SettingsSection>
        <SettingsSection title={t("security")}>
          <SettingsRow
            icon={Shield}
            tint="bg-primary/15 text-primary"
            title={t("desktopSecurity")}
            subtitle={t("desktopSecurityHint")}
            right={
              <ExternalLink className="h-4 w-4 shrink-0" aria-hidden="true" />
            }
            onClick={openSecuritySettings}
          />
          {failed && (
            <p role="alert" className="px-4 py-3 text-sm text-destructive">
              {t("desktopSecurityError")}
            </p>
          )}
        </SettingsSection>
      </div>
    </PageShell>
  );
}
