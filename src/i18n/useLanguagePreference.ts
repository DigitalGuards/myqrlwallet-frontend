import { useEffect, useState } from "react";
import StorageUtil, {
  STORAGE_EVENT_WALLET_SETTINGS,
} from "@/utils/storage/storage";
import { profileStorageKey } from "@/config/runtimeProfile";
import { logger } from "@/utils/log";
import { applyLanguage } from "./index";
import { detectLanguage, isLanguage } from "./languages";

/** Use the same settings record and change notifications as wallet preferences. */
export function useLanguagePreference(): boolean {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let disposed = false;
    const restore = async () => {
      try {
        const settings = await StorageUtil.getWalletSettings();
        if (disposed) return;
        const language = isLanguage(settings.language)
          ? settings.language
          : detectLanguage(navigator.languages);
        if (!isLanguage(settings.language))
          await StorageUtil.setWalletSettings({ language });
        await applyLanguage(language);
      } catch (error) {
        logger.error("Could not restore wallet language:", error);
      } finally {
        if (!disposed) setReady(true);
      }
    };
    const refresh = () => {
      void restore();
    };
    const onStorage = (event: StorageEvent) => {
      if (
        event.key === null ||
        event.key === profileStorageKey("WALLET_SETTINGS")
      )
        refresh();
    };
    refresh();
    window.addEventListener(STORAGE_EVENT_WALLET_SETTINGS, refresh);
    window.addEventListener("storage", onStorage);
    return () => {
      disposed = true;
      window.removeEventListener(STORAGE_EVENT_WALLET_SETTINGS, refresh);
      window.removeEventListener("storage", onStorage);
    };
  }, []);
  return ready;
}
