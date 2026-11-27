import { useCallback, useMemo, useState, type ReactNode } from "react";
import { SettingsBusyContext } from "./settingsBusyContext";

/** Collects the running operations; `forced` is one the page itself owns. */
export function SettingsBusyProvider({
  forced = false,
  children,
}: {
  forced?: boolean;
  children: ReactNode;
}) {
  const [sources, setSources] = useState<readonly string[]>([]);
  const report = useCallback((source: string, active: boolean) => {
    setSources((current) => {
      const has = current.includes(source);
      if (active === has) return current;
      return active
        ? [...current, source]
        : current.filter((entry) => entry !== source);
    });
  }, []);
  const value = useMemo(
    () => ({ busy: forced || sources.length > 0, report }),
    [forced, sources, report],
  );
  return (
    <SettingsBusyContext.Provider value={value}>
      {children}
    </SettingsBusyContext.Provider>
  );
}
