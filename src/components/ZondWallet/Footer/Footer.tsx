import withSuspense from "../../../functions/withSuspense";
import { observer } from "mobx-react-lite";
import { lazy, useState } from "react";
import { Check, ChevronUp, Copy, Github, Twitter } from "lucide-react";
import { Separator } from "../../../components/UI/Separator";
import { useStore } from "../../../stores/store";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/UI/Button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger, DropdownMenuItem, DropdownMenuSeparator } from "@/components/UI/DropdownMenu";

const ZondWalletLogo = withSuspense(
    lazy(() => import("../Header/ZondWalletLogo/ZondWalletLogo"))
);

const Footer = observer(() => {
    const { zondStore } = useStore();
    const { zondAccounts, setActiveAccount, activeAccount } = zondStore;
    const [copiedAddress, setCopiedAddress] = useState<string | null>(null);
    const navigate = useNavigate();
    const copyToClipboard = (text: string) => {
        navigator.clipboard.writeText(text);
        setCopiedAddress(text);
        setTimeout(() => {
            setCopiedAddress(null);
        }, 1000);
    };
    const switchAccount = (accountAddress: string) => {
        setActiveAccount(accountAddress);
    };

    return (
        <footer className="relative z-10 w-full border-t bg-background">
            <div className="hidden md:block mx-auto max-w-4xl px-4 py-6">
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
            <div className="md:hidden fixed bottom-0 w-full content-center h-16 bg-primary-foreground border-t">
                <div className="flex flex-row gap-2 items-center justify-center w-full h-full px-4">
                    <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                            <Button
                                variant="outline"
                                size="sm"
                                className="flex items-center gap-2"
                            >
                                <span className="truncate max-w-[100px]">
                                    Wallets
                                </span>
                                <ChevronUp size={16} />
                            </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="center">
                            {zondAccounts.accounts.map((account, idx) => (
                                <DropdownMenuItem
                                    key={idx}
                                    onClick={() => switchAccount(account.accountAddress)}
                                    className="flex items-center justify-between gap-2"
                                >
                                    <span className="flex items-center gap-2" onClick={() => switchAccount(account.accountAddress)}>
                                        {account.accountAddress.toLowerCase() === activeAccount.accountAddress.toLowerCase() ? (
                                            <div className="w-2 h-2 rounded-full bg-green-500"></div>
                                        ) : (<div className="w-2 h-2 rounded-full"></div>)}
                                        {account.accountAddress.substring(0, 15)}...
                                        {account.accountAddress.substring(account.accountAddress.length - 12)}
                                    </span>
                                    {copiedAddress === account.accountAddress ? (
                                        <Check className="w-4 h-4 text-green-500" />
                                    ) : (
                                        <Copy
                                            className="w-4 h-4 hover:text-gray-400 transition-opacity cursor-pointer"
                                            onClick={() => copyToClipboard(account.accountAddress)}
                                        />
                                    )}
                                </DropdownMenuItem>
                            ))}
                            <DropdownMenuSeparator />
                            <DropdownMenuItem className="cursor-pointer flex justify-center" onClick={() => navigate('/add-account')}>
                                <span className="text-sm">
                                    + Create or import an account
                                </span>
                            </DropdownMenuItem>
                        </DropdownMenuContent>
                    </DropdownMenu>
                    <Button
                        size="sm"
                        onClick={() => navigate('/create-token')}
                        variant="outline"
                    >
                        Create Token
                    </Button>
                    <Button
                        size="sm"
                        onClick={() => navigate('/settings')}
                        variant="outline"
                    >
                        Settings
                    </Button>
                </div>
            </div>
        </footer>
    );
});

export default Footer;
