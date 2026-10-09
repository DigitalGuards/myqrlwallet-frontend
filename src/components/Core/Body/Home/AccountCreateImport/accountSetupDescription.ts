import { isDesktop } from "@/desktop/bridge";
import { isInNativeApp } from "@/utils/nativeApp";

export function accountSetupDescription() {
  return isInNativeApp() || isDesktop
    ? "You are connected to the blockchain. Create a new account or import an existing account."
    : "You are connected to the blockchain. Create a new account, import an existing account, or connect a wallet you already use: your browser extension or the MyQRLWallet mobile app.";
}
