import { ROUTES } from "@/router/router";
import { useNavigate } from "react-router-dom";

export default function Footer() {
    const navigate = useNavigate();

    return (
        <footer className="fixed bottom-0 bg-background w-full z-10 border-t border-border/50">
            {/* Navigation Links */}
            <div className="h-8 md:h-10 flex items-center justify-center md:justify-start md:px-4 md:pl-12 gap-6 md:gap-12">
                <a className="text-xs md:text-sm cursor-pointer text-muted-foreground hover:text-foreground transition-colors" onClick={() => navigate(ROUTES.HOME)}>
                    Home
                </a>
                <a onClick={() => navigate(ROUTES.PRIVACY)} className="text-xs md:text-sm cursor-pointer text-muted-foreground hover:text-foreground transition-colors">
                    Privacy
                </a>
                <a onClick={() => navigate(ROUTES.TERMS)} className="text-xs md:text-sm cursor-pointer text-muted-foreground hover:text-foreground transition-colors">
                    Terms
                </a>
                <a onClick={() => navigate(ROUTES.SUPPORT)} className="text-xs md:text-sm cursor-pointer text-muted-foreground hover:text-foreground transition-colors">
                    Support
                </a>
            </div>
        </footer>
    )
}
