import { ROUTES } from "@/router/router";
import { useNavigate } from "react-router-dom";
import { AlertTriangle, ExternalLink } from "lucide-react";

export default function Footer() {
    const navigate = useNavigate();

    return (
        <footer className="fixed bottom-0 bg-background w-full z-10 border-t border-border/50">
            {/* Testnet Notice Banner */}
            <div className="bg-amber-500/10 border-b border-amber-500/20 px-4 py-2">
                <div className="flex items-center justify-center gap-2 text-xs md:text-sm">
                    <AlertTriangle className="h-3.5 w-3.5 md:h-4 md:w-4 text-amber-500 flex-shrink-0" />
                    <span className="text-amber-200/90">
                        This wallet is currently for the <a href="https://test-zond.theqrl.org/" target="_blank" rel="noopener noreferrer" className="font-semibold text-amber-400 hover:text-amber-300 transition-colors">Zond Testnet</a> only.
                    </span>
                    <span className="hidden sm:inline text-muted-foreground">|</span>
                    <a
                        href="https://wallet.theqrl.org/"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="hidden sm:inline-flex items-center gap-1 text-blue-400 hover:text-blue-300 transition-colors font-medium"
                    >
                        QRL Mainnet Wallet
                        <ExternalLink className="h-3 w-3" />
                    </a>
                </div>
                {/* Mobile-only mainnet link */}
                <div className="sm:hidden flex justify-center mt-1">
                    <a
                        href="https://wallet.theqrl.org/"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-xs text-blue-400 hover:text-blue-300 transition-colors font-medium"
                    >
                        QRL Mainnet Wallet
                        <ExternalLink className="h-3 w-3" />
                    </a>
                </div>
            </div>

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
