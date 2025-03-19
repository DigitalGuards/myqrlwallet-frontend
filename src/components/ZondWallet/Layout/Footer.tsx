import { ROUTES } from "@/router/router";
import { useNavigate } from "react-router-dom";

export default function Footer() {
    const navigate = useNavigate();

    return (
        <footer className="fixed bottom-0 md:border-t-2 border-t-secondary border-t-opacity-50 bg-background w-full z-10 h-6 md:h-10 flex items-center justify-center md:justify-start md:px-4 md:pl-12 gap-12">
            <a className="text-sm cursor-pointer text-muted-foreground hover:text-foreground transition-colors" onClick={() => navigate(ROUTES.HOME)}>
                Home
            </a>
            <a onClick={() => navigate(ROUTES.PRIVACY)} target="_blank" className="text-sm cursor-pointer text-muted-foreground hover:text-foreground transition-colors">
                Privacy
            </a>
            <a onClick={() => navigate(ROUTES.TERMS)} target="_blank" className="text-sm cursor-pointer text-muted-foreground hover:text-foreground transition-colors">
                Terms
            </a>
            <a onClick={() => navigate(ROUTES.SUPPORT)} target="_blank" className="text-sm cursor-pointer text-muted-foreground hover:text-foreground transition-colors">
                Support
            </a>
        </footer>
    )
}
