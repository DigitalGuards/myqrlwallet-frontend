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
        </div>
      </div>
    </>
  );
});

export default Home;
