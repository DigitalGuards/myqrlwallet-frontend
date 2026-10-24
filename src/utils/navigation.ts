/**
 * Navigation utilities with native app awareness
 */

import type { NavigateFunction } from "react-router";
import { isInNativeApp, openNativeSettings } from "@/utils/nativeApp";
import { ROUTES } from "@/router/router";

/**
 * Mobile Settings opens the native screen. Web and desktop Settings use
 * the renderer route, which selects the settings view for that platform.
 */
export const navigateTo = (url: string, navigate: NavigateFunction): void => {
  if (url === ROUTES.SETTINGS && isInNativeApp()) {
    openNativeSettings();
  } else {
    void navigate(url);
  }
};
