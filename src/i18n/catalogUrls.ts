import type { Language } from "./languages";

// The build supplies URLs for the same lazy catalog chunks. Development and
// the single-file embedded build use their original imports on every attempt.
export const catalogUrls: Partial<Record<Language, string>> = {};
