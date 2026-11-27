import { createContext, useContext, useEffect } from "react";

/**
 * Whether a Settings operation (a PIN change, a wallet file export) is
 * running. While one runs the category list stays on the category that
 * shows it, so its result is not left in a hidden pane.
 */
export type SettingsBusy = {
  busy: boolean;
  report: (source: string, active: boolean) => void;
};

export const SettingsBusyContext = createContext<SettingsBusy>({
  busy: false,
  report: () => undefined,
});

export function useSettingsBusy(): SettingsBusy {
  return useContext(SettingsBusyContext);
}

/** Report this component's running operation to the Settings page. */
export function useReportSettingsBusy(source: string, active: boolean): void {
  const { report } = useContext(SettingsBusyContext);
  useEffect(() => {
    report(source, active);
    return () => {
      report(source, false);
    };
  }, [report, source, active]);
}
