import { ROUTES } from "@/router/router";

export default function Footer() {
    return (
        <footer className="fixed bottom-0 md:border-t-2 border-t-secondary border-t-opacity-50 bg-background w-full z-10 h-6 md:h-10 flex items-center justify-center md:justify-start md:px-4 md:pl-12 gap-12">
            <a href={ROUTES.HOME} className="text-sm text-muted-foreground hover:text-foreground transition-colors">
                Home
            </a>
            <a href={ROUTES.PRIVACY} target="_blank" className="text-sm text-muted-foreground hover:text-foreground transition-colors">
                Privacy
            </a>
            <a href={ROUTES.TERMS} target="_blank" className="text-sm text-muted-foreground hover:text-foreground transition-colors">
                Terms
            </a>
            <a href={ROUTES.SUPPORT} target="_blank" className="text-sm text-muted-foreground hover:text-foreground transition-colors">
                Support
            </a>
        </footer>
    )
}
