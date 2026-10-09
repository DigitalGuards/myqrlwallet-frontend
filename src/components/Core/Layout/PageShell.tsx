import type { ReactNode } from "react";
import { SEO } from "@/components/SEO/SEO";
import { cn } from "@/utils/cn";

type PageShellProps = {
  title: ReactNode;
  subtitle?: ReactNode;
  action?: ReactNode;
  width?: "default" | "wide";
  seoTitle?: string;
  children: ReactNode;
};

export function PageShell({
  title,
  subtitle,
  action,
  width = "default",
  seoTitle,
  children,
}: PageShellProps) {
  return (
    <div className="w-full" data-page-shell={width}>
      {seoTitle && <SEO title={seoTitle} />}
      <div
        className={cn(
          "page-enter mx-auto w-full px-4 pt-8 pb-8",
          width === "wide" ? "max-w-3xl" : "max-w-2xl",
        )}
      >
        <header className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 flex-[1_1_16rem]">
            <h1 className="text-2xl font-semibold tracking-tight [overflow-wrap:anywhere]">
              {title}
            </h1>
            {subtitle && (
              <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>
            )}
          </div>
          {action && (
            <div className="ml-auto max-w-full shrink-0">{action}</div>
          )}
        </header>
        {children}
      </div>
    </div>
  );
}
