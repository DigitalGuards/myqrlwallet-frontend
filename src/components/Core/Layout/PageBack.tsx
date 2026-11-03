import { useEffect } from "react";
import { useLocation, useNavigate } from "react-router";
import {
  pageBack,
  type PageBackConfig,
  type PageBackOptions,
} from "@/router/pageBack";
import type { RoutePath } from "@/router/routes";
import { registerPageBack, resolveRouteBack } from "@/utils/nativeBack";
import { reportError } from "@/utils/reportError";
import { BackButton } from "./BackButton";

/**
 * A sub-page's Back. It returns to the previous in-app screen, or replaces
 * the page with its parent route when nothing came before. It never steps
 * browser history, which could leave the wallet for the site that opened it.
 *
 * It registers the parent and the held state with nativeBack, so Android
 * back in the phone app reaches the same screen, and holds while this does.
 */
export function PageBack({
  fallback,
  disabled = false,
  onBack,
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
        Promise.resolve(
          options ? navigate(target, options) : navigate(target),
        ).catch((error: unknown) => {
          reportError("Failed to navigate back:", error);
        });
      },
      path,
      fallback,
    );
  };

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
