import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  THEMES,
  isThemePreference,
  currentThemePreference,
  saveThemePreference,
  type ThemePreference,
} from "@/theme/preference";

/** Theme row: saves the choice, which the theme module applies at once. */
export function ThemeSettings() {
  const { t } = useTranslation("settings");
  const [theme, setTheme] = useState<ThemePreference>(currentThemePreference);
  const label = (value: ThemePreference): string => {
    if (value === "light") return t("themeLight");
    if (value === "system") return t("themeSystem");
    return t("themeDark");
  };

  return (
    <div className="py-3">
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1">
          <label htmlFor="wallet-theme" className="text-sm font-medium">
            {t("theme")}
          </label>
          <p
            id="wallet-theme-hint"
            className="mt-0.5 text-xs text-muted-foreground"
          >
            {t("themeHint")}
          </p>
        </div>
        <select
          id="wallet-theme"
          aria-describedby="wallet-theme-hint"
          className="h-10 max-w-full rounded-md border border-input bg-background px-2 text-sm"
          value={theme}
          onChange={(event) => {
            const value = event.target.value;
            if (!isThemePreference(value)) return;
            setTheme(value);
            saveThemePreference(value);
          }}
        >
          {THEMES.map((value) => (
            <option key={value} value={value}>
              {label(value)}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}
