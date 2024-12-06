import { createContext, useContext } from "react";
import SettingsStore from "./settingsStore";
import ZondStore from "./zondStore";
import { configure } from "mobx";

// Configure MobX
configure({
  enforceActions: "never",
  useProxies: "always"
});

class Store {
  settingsStore;
  zondStore;

  constructor() {
    this.settingsStore = new SettingsStore();
    this.zondStore = new ZondStore();
  }
}

export type StoreType = InstanceType<typeof Store>;

// Declare global window property for TypeScript
declare global {
  interface Window {
    __APP_STORE__?: Store;
  }
}

// Create store singleton that persists across hot reloads
const getStore = (): StoreType => {
  if (!window.__APP_STORE__) {
    window.__APP_STORE__ = new Store();
  }
  return window.__APP_STORE__;
};

export const store = getStore();
const StoreContext = createContext<StoreType>(store);

// Export provider and hook for React components
export const StoreProvider = StoreContext.Provider;
export const useStore = () => {
  const context = useContext(StoreContext);
  if (!context) {
    throw new Error('useStore must be used within a StoreProvider');
  }
  return context;
};
