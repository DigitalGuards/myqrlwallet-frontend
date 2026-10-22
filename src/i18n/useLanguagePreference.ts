import { useEffect } from "react";
import { logger } from "@/utils/log";
import { applyLanguage } from "./index";
import {
  LANGUAGE_CHANGED,
  LANGUAGE_STORAGE_KEY,
  readLanguagePreference,
  saveLanguagePreference,
} from "./preference";

/** Restore language independently of rendering and security preference expiry. */
export function useLanguagePreference(): void {
  useEffect(() => {
    const restore = () => {
      try {
        const language = readLanguagePreference();
        // Persist detection, legacy migration and corruption recovery before loading.
        saveLanguagePreference(language);
        void applyLanguage(language).catch((error: unknown) => {
          logger.error("Could not restore wallet language:", error);
        });
      } catch (error) {
        logger.error("Could not restore wallet language:", error);
      }
    };
    const onStorage = (event: StorageEvent) => {
      if (event.key === null || event.key === LANGUAGE_STORAGE_KEY) restore();
    };
    restore();
    window.addEventListener(LANGUAGE_CHANGED, restore);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener(LANGUAGE_CHANGED, restore);
      window.removeEventListener("storage", onStorage);
    };
  }, []);
}
