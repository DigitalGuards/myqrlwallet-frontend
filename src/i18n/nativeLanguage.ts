import { isInNativeApp, sendToNative } from "@/utils/nativeApp";
import { logger } from "@/utils/log";
import { applyLanguage, i18n } from "./index";
import type { Language } from "./languages";
import { saveLanguagePreference } from "./preference";

/** Notify the shell of the resolved renderer language without affecting activation. */
export function notifyNativeLanguage(language: Language): void {
  try {
    if (isInNativeApp()) {
      sendToNative("LANGUAGE_CHANGED", { language });
    } else if (typeof window.qrlWallet?.setLanguage === "function") {
      void Promise.resolve(window.qrlWallet.setLanguage(language)).catch(
        (error: unknown) => {
          logger.error("Could not notify shell language:", error);
        },
      );
    }
  } catch (error) {
    logger.error("Could not notify shell language:", error);
  }
}

/**
 * Apply the language chosen in the native Settings screen. A changed preference
 * also reaches useLanguagePreference, which reports the result to the shell.
 */
export function applyNativeLanguage(language: Language): void {
  try {
    saveLanguagePreference(language);
  } catch (error) {
    // Blocked storage still changes the language for this session.
    logger.error("Could not save wallet language:", error);
  }
  if (i18n.language === language) return;
  void applyLanguage(language).catch((error: unknown) => {
    logger.error("Could not apply wallet language:", error);
  });
}
