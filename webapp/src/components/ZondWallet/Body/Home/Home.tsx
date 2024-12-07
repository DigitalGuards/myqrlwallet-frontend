import withSuspense from "../../../../functions/withSuspense";
import { useStore } from "../../../../stores/store";
import { Loader, Github, Twitter } from "lucide-react";
import { observer } from "mobx-react-lite";
import { lazy } from "react";
import ConnectionFailed from "./ConnectionFailed/ConnectionFailed";

const AccountCreateImport = withSuspense(
  lazy(() => import("./AccountCreateImport/AccountCreateImport"))
);
const BackgroundVideo = withSuspense(
  lazy(() => import("./BackgroundVideo/BackgroundVideo"))
);
const ConnectionBadge = withSuspense(
  lazy(() => import("./ConnectionBadge/ConnectionBadge"))
);

const Home = observer(() => {
  const { zondStore } = useStore();
  const { zondConnection } = zondStore;
  const { isLoading, isConnected } = zondConnection;

  return (
    <>
      <BackgroundVideo />
      <div className="relative z-10 mx-auto flex max-w-2xl flex-col items-center gap-8 py-8">
        <img className="h-16 w-16" src="/icons/qrl/default.png" alt="QRL Logo" />
        {isLoading ? (
          <Loader className="animate-spin text-foreground" size={32} />
        ) : (
          <>
            <ConnectionBadge />
            {isConnected ? <AccountCreateImport /> : <ConnectionFailed />}
          </>
        )}
        
        {/* Social Links */}
        <div className="flex gap-4 text-foreground/60 hover:text-foreground/80">
          <a
            href="https://github.com/DigitalGuards/zondwebwallet/"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 transition-colors duration-200"
            aria-label="GitHub Repository"
          >
            <Github size={20} />
            <span className="text-sm">GitHub</span>
          </a>
          <a
            href="https://x.com/DigitalGuards"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 transition-colors duration-200"
            aria-label="Twitter Profile"
          >
            <Twitter size={20} />
            <span className="text-sm">Twitter</span>
          </a>
          <a
            href="https://digitalguards.nl/index.php/2024/12/05/introducing-zond-qrl-web-wallet-by-digitalguards/"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 transition-colors duration-200"
            aria-label="Blog Post"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"></path>
              <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"></path>
            </svg>
            <span className="text-sm">Blog</span>
          </a>
        </div>
      </div>
    </>
  );
});

export default Home;
