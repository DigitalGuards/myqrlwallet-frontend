/**
 * Navigation utilities with native app awareness
 */

import type { NavigateFunction } from "react-router-dom";
import { isInNativeApp, openNativeSettings } from "@/utils/nativeApp";
import { isDesktop, desktopSigner } from "@/desktop/bridge";
import { ROUTES } from "@/router/router";

/**
 * Navigate to a route, with special handling for native contexts: on mobile
 * and on desktop, Settings is a NATIVE surface, not a web route. The mobile
 * app opens its native settings screen; the desktop asks main to draw the
 * native settings window (auto-lock, biometric unlock, protocol handler,
 * remove account). The web settings page is only ever reached in a plain
 * browser.
 */
export const navigateTo = (url: string, navigate: NavigateFunction): void => {
  if (url === ROUTES.SETTINGS && isInNativeApp()) {
    openNativeSettings();
  } else if (url === ROUTES.SETTINGS && isDesktop) {
    void desktopSigner.openDesktopSettings();
  } else {
    navigate(url);
  }
};
