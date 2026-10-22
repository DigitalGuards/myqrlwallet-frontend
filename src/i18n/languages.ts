export const languages = [
  { code: "en", name: "English" },
  { code: "de", name: "Deutsch" },
  { code: "es", name: "Español" },
  { code: "ru", name: "Русский" },
  { code: "zh-CN", name: "简体中文" },
] as const;

export type Language = (typeof languages)[number]["code"];

export function isLanguage(value: unknown): value is Language {
  return languages.some(({ code }) => code === value);
}

/** Choose the first supported browser preference, then fall back to English. */
export function detectLanguage(preferences: readonly string[]): Language {
  for (const preference of preferences) {
    const tag = preference.toLowerCase();
    if (/^en(?:-|$)/.test(tag)) return "en";
    if (/^de(?:-|$)/.test(tag)) return "de";
    if (/^es(?:-|$)/.test(tag)) return "es";
    if (/^ru(?:-|$)/.test(tag)) return "ru";
    if (/^zh-(?:cn|hans|sg)(?:-|$)/.test(tag)) return "zh-CN";
  }
  return "en";
}
