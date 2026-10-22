import { useEffect, useState } from "react";
import english from "@/locales/en/notices.json";

type NoticeKey = keyof typeof english;
const englishText = (key: NoticeKey): string => english[key];

/** Boot recovery must render before any optional translation module loads. */
export function useBootNoticeTranslation(): (key: NoticeKey) => string {
  const [translate, setTranslate] = useState(() => englishText);
  useEffect(() => {
    let cancelled = false;
    let unsubscribe: (() => void) | undefined;
    void Promise.all([import("./index"), import("./preference")])
      .then(([{ i18n, applyLanguage }, preference]) => {
        if (cancelled) return;
        const refresh = () => {
          if (cancelled) return;
          setTranslate(
            () => (key: NoticeKey) =>
              i18n.t(key, { ns: "notices", defaultValue: english[key] }),
          );
        };
        const restore = () => {
          try {
            const language = preference.readLanguagePreference();
            preference.saveLanguagePreference(language);
            void applyLanguage(language)
              .then(refresh)
              .catch(() => {
                if (!cancelled) setTranslate(() => englishText);
              });
          } catch {
            setTranslate(() => englishText);
          }
        };
        const onStorage = (event: StorageEvent) => {
          if (
            event.key === null ||
            event.key === preference.LANGUAGE_STORAGE_KEY
          )
            restore();
        };
        i18n.on("languageChanged", refresh);
        window.addEventListener(preference.LANGUAGE_CHANGED, restore);
        window.addEventListener("storage", onStorage);
        unsubscribe = () => {
          i18n.off("languageChanged", refresh);
          window.removeEventListener(preference.LANGUAGE_CHANGED, restore);
          window.removeEventListener("storage", onStorage);
        };
        restore();
      })
      .catch(() => {
        // The initial English notice stays usable if the runtime chunk is missing.
      });
    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, []);
  return translate;
}
