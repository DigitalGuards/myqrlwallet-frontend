import type { NavigateFunction } from "react-router";

/** Renderer preferences are shared; Settings links to device-owned controls. */
export const navigateTo = (url: string, navigate: NavigateFunction): void => {
  void navigate(url);
};
