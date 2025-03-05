import withSuspense from "../../../functions/withSuspense";
import { observer } from "mobx-react-lite";
import { lazy } from "react";
import { Github, Twitter } from "lucide-react";
import { Separator } from "../../../components/UI/Separator";

const ZondWalletLogo = withSuspense(
    lazy(() => import("../Header/ZondWalletLogo/ZondWalletLogo"))
);

const Footer = observer(() => {
    return (
        <footer className="relative z-10 w-full border-t bg-background">
            <div className="mx-auto max-w-4xl px-4 py-6">
                <div className="flex flex-col items-center justify-between gap-4 sm:flex-row">
                    <ZondWalletLogo showText={false} size="lg" />

                    <div className="flex items-center gap-4">
                        <div className="flex gap-4 text-foreground/60">
                            <a
                                href="https://github.com/DigitalGuards/"
                                target="_blank"
                                rel="noopener noreferrer"
                                className="flex items-center gap-2 transition-colors duration-200 hover:text-foreground/80"
                                aria-label="GitHub Repository"
                            >
                                <Github size={20} />
                                <span className="text-sm">GitHub</span>
                            </a>
                            <a
                                href="https://x.com/DigitalGuards"
                                target="_blank"
                                rel="noopener noreferrer"
                                className="flex items-center gap-2 transition-colors duration-200 hover:text-foreground/80"
                                aria-label="Twitter Profile"
                            >
                                <Twitter size={20} />
                                <span className="text-sm">Twitter</span>
                            </a>
                            <a
                                href="https://digitalguards.nl/index.php/2024/12/05/introducing-zond-qrl-web-wallet-by-digitalguards/"
                                target="_blank"
                                rel="noopener noreferrer"
                                className="flex items-center gap-2 transition-colors duration-200 hover:text-foreground/80"
                                aria-label="Blog Post"
                            >
                                <svg
                                    xmlns="http://www.w3.org/2000/svg"
                                    width="20"
                                    height="20"
                                    viewBox="0 0 24 24"
                                    fill="none"
                                    stroke="currentColor"
                                    strokeWidth="2"
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                >
                                    <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"></path>
                                    <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"></path>
                                </svg>
                                <span className="text-sm">Blog</span>
                            </a>
                        </div>
                    </div>
                </div>

                <Separator className="my-4" />

                <div className="text-center text-sm text-muted-foreground">
                    <p>© {new Date().getFullYear()} DigitalGuards. All rights reserved.</p>
                </div>
            </div>
        </footer>
    );
});

export default Footer;
