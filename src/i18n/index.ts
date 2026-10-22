import { catalogUrls } from "./catalogUrls";
import { isRecord } from "@/utils/guards";
import { createInstance } from "i18next";
import { initReactI18next } from "react-i18next";
import english from "@/locales/en";
import type { Language } from "./languages";

export const defaultNS = "common";
export const namespaces = [
  "onboarding",
  "common",
  "home",
  "settings",
  "tokens",
  "history",
  "transfer",
  "accounts",
  "contacts",
] as const;
export const i18n = createInstance();

// English is synchronous and bundled. Each other language is one lazy chunk.
// React escapes interpolated text; catalogs never supply raw HTML.
export const i18nReady = i18n.use(initReactI18next).init({
  resources: { en: english },
  lng: "en",
  fallbackLng: "en",
  supportedLngs: ["en", "de", "es", "ru", "zh-CN"],
  load: "currentOnly",
  ns: [...namespaces],
  defaultNS,
  initAsync: false,
  returnEmptyString: false,
  interpolation: { escapeValue: false },
  react: { useSuspense: false },
});

const loaders = {
  de: () => import("@/locales/de"),
  es: () => import("@/locales/es"),
  ru: () => import("@/locales/ru"),
  "zh-CN": () => import("@/locales/zh-CN"),
};

export const CATALOG_TIMEOUT_MS = 3000;
const catalogAttempts = new Map<Language, number>();

function catalogResources(
  value: unknown,
): Record<string, Record<string, string>> {
  if (!isRecord(value) || !isRecord(value["default"]))
    throw new Error("Invalid language catalog");
  const resources: Record<string, Record<string, string>> = {};
  for (const ns of namespaces) {
    const entries = value["default"][ns];
    if (!isRecord(entries)) throw new Error("Invalid language namespace");
    const messages: Record<string, string> = {};
    for (const [key, message] of Object.entries(entries)) {
      if (typeof message !== "string")
        throw new Error("Invalid language message");
      messages[key] = message;
    }
    resources[ns] = messages;
  }
  return resources;
}

export async function loadLanguage(language: Language): Promise<void> {
  await i18nReady;
  if (
    language === "en" ||
    namespaces.every((ns) => i18n.hasResourceBundle(language, ns))
  )
    return;
  const attempt = catalogAttempts.get(language) ?? 0;
  const url = catalogUrls[language];
  // Browsers cache a failed module fetch by URL. Retry the same build-owned
  // chunk under a fresh URL, without reloading the wallet or accepting a late result.
  const catalog: Promise<unknown> =
    url && attempt > 0
      ? import(/* @vite-ignore */ `${url}?catalog-retry=${attempt}`)
      : loaders[language]();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_resolve, reject) => {
    timeout = setTimeout(() => {
      reject(new Error("Language catalog timed out"));
    }, CATALOG_TIMEOUT_MS);
  });
  const loaded = await Promise.race([catalog, deadline])
    .catch((error: unknown) => {
      catalogAttempts.set(
        language,
        Math.max(catalogAttempts.get(language) ?? 0, attempt + 1),
      );
      throw error;
    })
    .finally(() => {
      clearTimeout(timeout);
    });
  const resources = catalogResources(loaded);
  for (const ns of namespaces) {
    const messages = resources[ns];
    if (messages) i18n.addResourceBundle(language, ns, messages);
  }
}

let languageRequest = 0;

/** A slow earlier import cannot overwrite a more recent language choice. */
export async function applyLanguage(language: Language): Promise<void> {
  const request = ++languageRequest;
  try {
    await loadLanguage(language);
    if (request !== languageRequest) return;
    await i18n.changeLanguage(language);
  } catch (error) {
    if (request !== languageRequest) return;
    await i18n.changeLanguage("en");
    throw error;
  }
}

i18n.on("languageChanged", (language: string) => {
  if (typeof document !== "undefined") document.documentElement.lang = language;
});
