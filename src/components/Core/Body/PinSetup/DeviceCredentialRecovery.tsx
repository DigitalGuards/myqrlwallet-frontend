import { useTranslation } from "react-i18next";
import { useState } from "react";
import { Button } from "@/components/UI/Button";
import { isInNativeApp, openNativeSettings } from "@/utils/nativeApp";

/** Recovery guidance leaves removal and authentication with their existing owner. */
export function DeviceCredentialRecovery() {
  const { t } = useTranslation(["onboarding", "common", "settings"]);
  const native = isInNativeApp();
  const [settingsUnavailable, setSettingsUnavailable] = useState(false);

  return (
    <section
      role="alert"
      aria-label={t("onboarding:recoveryLabel")}
      className="space-y-3 rounded-lg border border-destructive/50 p-4 text-sm"
    >
      <h3 className="font-semibold">{t("onboarding:recoveryHeading")}</h3>
      <p>
        {t(
          native
            ? "onboarding:recoveryRetryApp"
            : "onboarding:recoveryRetryBrowser",
        )}
      </p>
      <p>{t("onboarding:recoveryBackups")}</p>
      {native ? (
        <>
          <p>{t("onboarding:recoveryNative")}</p>
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              setSettingsUnavailable(!openNativeSettings());
            }}
          >
            {t("onboarding:openAppSettings")}
          </Button>
          {settingsUnavailable && <p>{t("onboarding:settingsFallback")}</p>}
        </>
      ) : (
        <p>{t("onboarding:recoveryBrowser")}</p>
      )}
    </section>
  );
}
