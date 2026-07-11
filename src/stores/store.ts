import { createContext, useContext } from "react";
import QrlStore from "./qrlStore";
import TokenStore from "./tokenStore";
import NftStore from "./nftStore";
import DAppConnectStore from "./dappConnectStore";
import { maybeRestoreMobileConnection } from "@/utils/mobileConnect/mobileConnection";
import { StorageUtil } from "@/utils/storage";
import { configure } from "mobx";

// Configure MobX
configure({
  enforceActions: "never",
  useProxies: "always"
});

class Store {
  qrlStore;
  tokenStore;
  nftStore;
  dappConnectStore;

  constructor() {
    this.qrlStore = new QrlStore();
    this.tokenStore = new TokenStore(this.qrlStore);
    this.nftStore = new NftStore(this.qrlStore, this.tokenStore);
    this.dappConnectStore = new DAppConnectStore();

    // Wire qrlStore's post-init/post-account-change hooks to the
    // domain stores. Keeping qrlStore decoupled from tokenStore/nftStore
    // avoids circular deps; Store owns the orchestration.
    this.qrlStore.onBlockchainReady = async () => {
      await this.tokenStore.initialize();
      await this.nftStore.initialize();

      // Resume a mobile-app pairing (QRL Connect relay) if the SDK holds a
      // stored session AND the account list still has a mobile-sourced
      // account. Fire-and-forget: pairing restore must never block init.
      try {
        const list = await StorageUtil.getAccountList(
          this.qrlStore.qrlConnection.blockchain,
        );
        const hasMobileAccount = list.some((item) => item.source === 'mobile');
        void maybeRestoreMobileConnection(this.qrlStore, hasMobileAccount).catch(
          (error: unknown) => {
            console.error('Mobile pairing restore failed:', error);
          },
        );
      } catch (error) {
        console.error('Mobile pairing restore skipped:', error);
      }
    };
    this.qrlStore.onActiveAccountChanged = async (newActiveAccount?: string) => {
      await this.tokenStore.handleActiveAccountChanged(newActiveAccount);
      await this.nftStore.handleActiveAccountChanged(newActiveAccount);
    };
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
