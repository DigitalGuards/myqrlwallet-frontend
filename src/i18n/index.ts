import { createInstance } from "i18next";
import { initReactI18next } from "react-i18next";
import english from "@/locales/en";
import type { Language } from "./languages";

export const defaultNS = "common";
export const namespaces = [
  "common",
  "home",
  "settings",
  "tokens",
  "history",
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

export async function loadLanguage(language: Language): Promise<void> {
  await i18nReady;
  if (
    language === "en" ||
    namespaces.every((ns) => i18n.hasResourceBundle(language, ns))
  )
    return;
  const catalog = loaders[language]();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_resolve, reject) => {
    timeout = setTimeout(() => {
      reject(new Error("Language catalog timed out"));
    }, CATALOG_TIMEOUT_MS);
  });
  const { default: resources } = await Promise.race([
    catalog,
    deadline,
  ]).finally(() => {
    clearTimeout(timeout);
  });
  for (const ns of namespaces)
    i18n.addResourceBundle(language, ns, resources[ns]);
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
