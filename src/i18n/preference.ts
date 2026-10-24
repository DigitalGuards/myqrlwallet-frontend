import { profileStorageKey } from "@/config/runtimeProfile";
import { isRecord } from "@/utils/guards";
import { detectLanguage, isLanguage, type Language } from "./languages";

export const LANGUAGE_STORAGE_KEY = profileStorageKey("WALLET_LANGUAGE");
export const LANGUAGE_CHANGED = "qrl-wallet:language-changed";

/** Read the slice's earlier field without refreshing or expiring wallet settings. */
function storedLanguage(): { present: boolean; value?: unknown } {
  const saved = localStorage.getItem(LANGUAGE_STORAGE_KEY);
  if (saved !== null) {
    try {
      const value: unknown = JSON.parse(saved);
      return { present: true, value };
    } catch {
      return { present: true };
    }
  }
  const legacy = localStorage.getItem(profileStorageKey("WALLET_SETTINGS"));
  if (legacy !== null) {
    try {
      const record: unknown = JSON.parse(legacy);
      if (
        isRecord(record) &&
        isRecord(record["value"]) &&
        Object.prototype.hasOwnProperty.call(record["value"], "language")
      ) {
        return { present: true, value: record["value"]["language"] };
      }
    } catch {
      // A settings record without a readable language has no language choice.
    }
  }
  return { present: false };
}

export function readLanguagePreference(): Language {
  const saved = storedLanguage();
  if (saved.present) return isLanguage(saved.value) ? saved.value : "en";
  return detectLanguage(navigator.languages);
}

export function saveLanguagePreference(language: Language): void {
  const serialized = JSON.stringify(language);
  if (localStorage.getItem(LANGUAGE_STORAGE_KEY) === serialized) return;
  localStorage.setItem(LANGUAGE_STORAGE_KEY, serialized);
  window.dispatchEvent(new Event(LANGUAGE_CHANGED));
}
