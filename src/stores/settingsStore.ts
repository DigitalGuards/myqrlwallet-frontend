import { makeAutoObservable, observable } from "mobx";

const THEME = Object.freeze({
  DARK: "dark",
  LIGHT: "light",
});

class SettingsStore {
  isDarkMode;
  theme;

  constructor() {
    makeAutoObservable(this, { isDarkMode: observable, theme: observable });
    // Always default to dark mode
    this.isDarkMode = true;
    this.theme = THEME.DARK;
    document?.documentElement?.classList?.add(this.theme);
  }
}

export default SettingsStore;
