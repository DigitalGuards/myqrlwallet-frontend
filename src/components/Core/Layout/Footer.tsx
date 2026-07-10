import { EXPLORER_BASE } from "@/config";
import { ROUTES } from "@/router/router";
import { Link } from "react-router-dom";
import { cn } from "@/utils/cn";

/**
 * The Home / Privacy / Terms / Explorer link row. Rendered two ways:
 * - desktop: pinned in the fixed bottom Footer bar.
 * - mobile: inlined at the end of the page content (the fixed footer is
 *   hidden so it does not collide with the bottom tab bar).
 */
export function FooterLinks({ className }: { className?: string }) {
    const linkClass =
        "text-xs md:text-sm cursor-pointer text-muted-foreground hover:text-foreground transition-colors";

    return (
        <div className={cn("flex items-center justify-center gap-6 md:gap-12", className)}>
            <Link className={linkClass} to={ROUTES.HOME}>
                Home
            </Link>
            <Link className={linkClass} to={ROUTES.PRIVACY}>
                Privacy
            </Link>
            <Link className={linkClass} to={ROUTES.TERMS}>
                Terms
            </Link>
            <a
                href={EXPLORER_BASE}
                target="_blank"
                rel="noopener noreferrer"
                className={linkClass}
            >
                Explorer
            </a>
        </div>
    );
}

export default function Footer() {
    return (
        // Hidden on mobile: the links move into the page flow (see Layout) so
        // they don't stack on top of the bottom tab bar.
        <footer className="hidden md:block fixed bottom-0 bg-background/80 backdrop-blur-md w-full z-10 border-t border-foreground/[0.06]">
            <FooterLinks className="h-10" />
        </footer>
    );
}
