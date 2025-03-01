import withSuspense from "../../../../functions/withSuspense";
import { useStore } from "../../../../stores/store";
import { Loader } from "lucide-react";
import { observer } from "mobx-react-lite";
import { lazy } from "react";
import ConnectionFailed from "./ConnectionFailed/ConnectionFailed";
import { SEO } from "../../../SEO/SEO";

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
      <SEO
        title="Home"
        description="Welcome to the QRL Zond Web3 Wallet. Create or import your quantum-resistant wallet and start managing your QRL assets securely."
        keywords="QRL Wallet, Create Wallet, Import Wallet, Quantum Resistant, Web3"
      />
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
      </div>
    </>
  );
});

export default Home;
