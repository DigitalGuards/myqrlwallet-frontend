/**
 * Navigation utilities with native app awareness
 */

import { NavigateFunction } from "react-router-dom";
import { isInNativeApp, openNativeSettings } from "@/utils/nativeApp";
import { ROUTES } from "@/router/router";

/**
 * Navigate to a route, with special handling for native app context
 * Settings route redirects to native settings when running in mobile app
 */
export const navigateTo = (url: string, navigate: NavigateFunction): void => {
  if (url === ROUTES.SETTINGS && isInNativeApp()) {
    openNativeSettings();
  } else {
    navigate(url);
  }
};
