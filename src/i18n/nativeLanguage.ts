import { isInNativeApp, sendToNative } from "@/utils/nativeApp";
import { logger } from "@/utils/log";
import type { Language } from "./languages";

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
