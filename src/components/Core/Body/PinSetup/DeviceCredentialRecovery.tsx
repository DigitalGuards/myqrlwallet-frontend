import { useState } from "react";
import { Button } from "@/components/UI/Button";
import { isInNativeApp, openNativeSettings } from "@/utils/nativeApp";

/** Recovery guidance leaves removal and authentication with their existing owner. */
export function DeviceCredentialRecovery() {
  const native = isInNativeApp();
  const [settingsUnavailable, setSettingsUnavailable] = useState(false);

  return (
    <section
      role="alert"
      aria-label="Wallet recovery guidance"
      className="space-y-3 rounded-lg border border-destructive/50 p-4 text-sm"
    >
      <h3 className="font-semibold">Wallet recovery</h3>
      <p>
        The device security credential is unavailable. Close and reopen the
        {native ? " app" : " browser"}, then try again. Your existing wallet
        data has been kept.
      </p>
      <p>
        Before removing any wallet data, verify that you have a recovery phrase
        or an independently usable exported backup for every wallet, including
        wallets saved under earlier network profiles. A copy of device-encrypted
        data alone cannot recover a wallet when its device credential is lost.
        Keep all wallet data if any recovery backup is missing.
      </p>
      {native ? (
        <>
          <p>
            If retrying still fails and every wallet has a usable backup, open
            app Settings and choose Remove All Wallets. Complete the app's
            authentication and confirmation steps. This permanently removes all
            wallets and preserved earlier backups from this device. Once removal
            completes, import each wallet using its recovery backup.
          </p>
          <Button
            type="button"
            variant="outline"
            onClick={() => setSettingsUnavailable(!openNativeSettings())}
          >
            Open app settings
          </Button>
          {settingsUnavailable && (
            <p>
              Open Settings from the app navigation to review recovery options.
            </p>
          )}
        </>
      ) : (
        <p>
          If retrying still fails, use a separate browser profile to import a
          recovery phrase or independently usable exported backup. Keep this
          browser profile and its wallet data until every wallet is recovered.
        </p>
      )}
    </section>
  );
}
