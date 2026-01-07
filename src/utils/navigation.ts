/**
 * Navigation utilities with native app awareness
 */

import { NavigateFunction } from "react-router-dom";
import { isInNativeApp, openNativeSettings } from "@/utils/nativeApp";
import { ROUTES } from "@/router/router";

// Module load log - this should appear when the file is first imported
console.log('[Navigation] navigation.ts module loaded');

/**
 * Navigate to a route, with special handling for native app context
 * Settings route redirects to native settings when running in mobile app
 */
export const navigateTo = (url: string, navigate: NavigateFunction): void => {
  const inNative = isInNativeApp();
  const isSettings = url === ROUTES.SETTINGS;

  console.log(`[Navigation] navigateTo called: url=${url}, isSettings=${isSettings}, inNativeApp=${inNative}`);

  if (isSettings && inNative) {
    console.log('[Navigation] Redirecting to native settings');
    const sent = openNativeSettings();
    console.log(`[Navigation] openNativeSettings result: ${sent}`);
  } else {
    console.log(`[Navigation] Using standard navigation to ${url}`);
    navigate(url);
  }
};
