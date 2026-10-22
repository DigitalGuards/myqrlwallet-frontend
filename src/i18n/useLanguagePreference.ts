import { useEffect, useRef } from "react";
import { logger } from "@/utils/log";
import { applyLanguage, i18n } from "./index";
import { isLanguage, type Language } from "./languages";
import { notifyNativeLanguage } from "./nativeLanguage";
import {
  LANGUAGE_CHANGED,
  LANGUAGE_STORAGE_KEY,
  readLanguagePreference,
  saveLanguagePreference,
} from "./preference";

/** Restore language independently of rendering and security preference expiry. */
export function useLanguagePreference(): void {
  const lastSignalled = useRef<Language | undefined>(undefined);
  useEffect(() => {
    const onResolved = (language: string) => {
      if (!isLanguage(language) || lastSignalled.current === language) return;
      lastSignalled.current = language;
      notifyNativeLanguage(language);
    };
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
    // The bundled English initialization precedes this subscription. Signal only
    // after restoration resolves, including English on catalog failure/timeout.
    i18n.on("languageChanged", onResolved);
    restore();
    window.addEventListener(LANGUAGE_CHANGED, restore);
    window.addEventListener("storage", onStorage);
    return () => {
      i18n.off("languageChanged", onResolved);
      window.removeEventListener(LANGUAGE_CHANGED, restore);
      window.removeEventListener("storage", onStorage);
    };
  }, []);
}
