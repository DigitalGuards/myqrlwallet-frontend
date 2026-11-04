import { useEffect } from "react";
import { useLocation, useNavigate } from "react-router";
import {
  followsBrowserHistory,
  historyIndex,
  pageBack,
  type PageBackConfig,
  type PageBackOptions,
} from "@/router/pageBack";
import type { RoutePath } from "@/router/routes";
import { registerPageBack, resolveRouteBack } from "@/utils/nativeBack";
import { reportError } from "@/utils/reportError";
import { BackButton } from "./BackButton";

/** Reports a navigation that failed, whichever way it settles. */
function settle(navigation: void | Promise<void>): void {
  Promise.resolve(navigation).catch((error: unknown) => {
    reportError("Failed to navigate back:", error);
  });
}

/**
 * A sub-page's Back. It returns to the previous in-app screen, or replaces
 * the page with its parent route when nothing came before. On the web
 * wallet it steps the browser's history back when the previous screen is
 * the entry right behind, so the browser's own Back stays in step. It never
 * steps back past the first screen of this page load, which could leave
 * the wallet for the site that opened it.
 *
 * It registers the parent and the held state with nativeBack, so Android
 * back in the phone app reaches the same screen, and holds while this does.
 */
export function PageBack({
  fallback,
  disabled = false,
  hidden = false,
  onBack,
  platform,
}: PageBackConfig) {
  const navigate = useNavigate();
  const { pathname, search } = useLocation();
  const path = `${pathname}${search}`;

  useEffect(
    () => registerPageBack({ path, fallback, disabled }),
    [path, fallback, disabled],
  );

  const goBack = () => {
    if (disabled) return;
    if (onBack) {
      onBack();
      return;
    }
    resolveRouteBack(
      (target, options) => {
        settle(options ? navigate(target, options) : navigate(target));
      },
      path,
      fallback,
      followsBrowserHistory(platform)
        ? {
            // Read when pressed: the browser moves through history without
            // asking.
            index: historyIndex(),
            back: () => {
              settle(navigate(-1));
            },
          }
        : undefined,
    );
  };

  if (hidden) return null;
  return (
    <div data-page-back="" className="-mt-2 mb-2">
      <BackButton onClick={goBack} disabled={disabled} />
    </div>
  );
}

type RouteBackProps = PageBackOptions & {
  /** The page's route, which names its parent in the Back table. */
  route: RoutePath;
};

/**
 * The Back of the page at `route`, for PageShell's `back` slot. It renders
 * nothing on a menu destination.
 */
export function RouteBack({ route, ...options }: RouteBackProps) {
  const back = pageBack(route, options);
  return back ? <PageBack {...back} /> : null;
}
