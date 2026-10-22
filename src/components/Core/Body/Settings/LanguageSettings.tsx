import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Languages } from "lucide-react";
import { languages, isLanguage } from "@/i18n/languages";
import { applyLanguage, loadLanguage } from "@/i18n";
import StorageUtil from "@/utils/storage/storage";
import { SettingsIconTile } from "./SettingsList";

export function LanguageSettings() {
  const { t, i18n } = useTranslation("settings");
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);

  const select = async (value: string) => {
    if (!isLanguage(value)) return;
    setPending(true);
    setFailed(false);
    try {
      await loadLanguage(value);
      await StorageUtil.setWalletSettings({ language: value });
      await applyLanguage(value);
    } catch {
      setFailed(true);
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="px-4 py-3">
      <div className="flex flex-wrap items-center gap-3">
        <SettingsIconTile icon={Languages} tint="bg-primary/15 text-primary" />
        <div className="min-w-0 flex-1">
          <label htmlFor="wallet-language" className="text-sm font-medium">
            {t("language")}
          </label>
          <p
            id="wallet-language-hint"
            className="mt-0.5 text-xs text-muted-foreground"
          >
            {t("languageHint")}
          </p>
        </div>
        <select
          id="wallet-language"
          aria-describedby="wallet-language-hint"
          className="h-10 max-w-full rounded-md border border-input bg-background px-2 text-sm"
          value={i18n.resolvedLanguage ?? "en"}
          disabled={pending}
          onChange={(event) => {
            void select(event.target.value);
          }}
        >
          {languages.map(({ code, name }) => (
            <option key={code} value={code} lang={code}>
              {name}
            </option>
          ))}
        </select>
      </div>
      {failed && (
        <p role="alert" className="mt-2 text-sm text-destructive">
          {t("languageError")}
        </p>
      )}
    </div>
  );
}
