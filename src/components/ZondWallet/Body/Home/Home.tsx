import { withSuspense } from "@/utils/react";
import { useStore } from "../../../../stores/store";
import { Loader, Send, History, QrCode } from "lucide-react";
import { observer } from "mobx-react-lite";
import { lazy, useEffect, useRef, useState } from "react";
import ConnectionFailed from "./ConnectionFailed/ConnectionFailed";
import { SEO } from "../../../SEO/SEO";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/UI/Card";
import { Button } from "@/components/UI/Button";
import { ROUTES } from "@/router/router";
import { ActiveAccountDisplay } from "./AccountCreateImport/ActiveAccountDisplay/ActiveAccountDisplay";
import { cva } from "class-variance-authority";
import { useLocation, Link } from "react-router-dom";
import ConnectionBadge from "./ConnectionBadge/ConnectionBadge";
import { TransactionHistoryPopup } from "../AccountList/ActiveAccount/TransactionHistoryPopup";
import { ReceivePopup } from "./ReceivePopup";

const AccountCreateImport = withSuspense(
  lazy(() => import("./AccountCreateImport/AccountCreateImport"))
);
const BackgroundVideo = withSuspense(
  lazy(() => import("./BackgroundVideo/BackgroundVideo"))
);

const TokenForm = withSuspense(
  lazy(() => import("../Tokens/TokenForm/TokenForm"))
);

const Home = observer(() => {
  const { state } = useLocation();
  const { zondStore } = useStore();
  const { zondConnection, activeAccount } = zondStore;
  const { isLoading, isConnected, blockchain } = zondConnection;
  const hasAccountCreationPreference = !!state?.hasAccountCreationPreference;
  const refreshIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const [txHistoryOpen, setTxHistoryOpen] = useState(false);
  const [receiveOpen, setReceiveOpen] = useState(false);

  // Function to track if any modal is open
  const checkIfModalOpen = () => {
    // Check if any dialog elements are open in the DOM
    const openDialogs = document.querySelectorAll('div[role="dialog"]');
    return openDialogs.length > 0;
  };

  // Set up auto-refresh for balances
  useEffect(() => {
    if (activeAccount.accountAddress) {
      // Refresh immediately on mount
      zondStore.fetchAccounts();
      zondStore.refreshTokenBalances();
      
      // Set up recurring refresh every 30 seconds
      refreshIntervalRef.current = setInterval(() => {
        // Only refresh if no modals are open
        if (!checkIfModalOpen()) {
          zondStore.fetchAccounts();
          zondStore.refreshTokenBalances();
        }
      }, 30000); // 30 seconds
    }
    
    return () => {
      if (refreshIntervalRef.current) {
        clearInterval(refreshIntervalRef.current);
      }
    };
  }, [activeAccount.accountAddress, zondStore]);

  const accountCreateImportClasses = cva("flex gap-8", {
    variants: {
      hasAccountCreationPreference: {
        true: ["flex-col-reverse"],
        false: ["flex-col"],
      },
    },
    defaultVariants: {
      hasAccountCreationPreference: false,
    },
  });

  return (
    <>
      <SEO
        title="Home"
        description="Welcome to the QRL Zond Web3 Wallet. Create or import your quantum-resistant wallet and start managing your QRL assets securely."
        keywords="QRL Wallet, Create Wallet, Import Wallet, Quantum Resistant, Web3"
      />
      <BackgroundVideo />
      <div className="relative z-10 mx-auto flex max-w-2xl flex-col items-center gap-2 md:gap-4 md:py-4">
        <img className="h-14 md:h-20" src="/mqrlwallet.png" alt="MyQRLWallet Logo" />
        {isLoading ? (
          <Loader className="animate-spin text-foreground" size={32} />
        ) : (
          <>
            <ConnectionBadge />


            <div
              className={accountCreateImportClasses({ hasAccountCreationPreference })}
            >
              {activeAccount.accountAddress && (
                <Card className="w-full relative overflow-hidden border-l-4 border-l-blue-accent">
                  <div className="absolute inset-0 overflow-hidden">
                    <video
                      autoPlay
                      muted
                      loop
                      playsInline
                      className="w-full h-full object-cover opacity-30"
                    >
                      <source src="qrl-video-dark.mp4" type="video/mp4" />
                    </video>
                  </div>
                  <div className="relative z-10">
                    <CardHeader className="bg-gradient-to-r from-blue-accent/5 to-transparent">
                      <CardTitle className="text-2xl font-bold">Active account</CardTitle>
                      </CardHeader>
                      <CardContent>
                        <ActiveAccountDisplay />
                      </CardContent>
                      <CardFooter className="justify-end gap-2">
                        <Link className="flex-1" to={ROUTES.ACCOUNT_DETAILS}>
                          <Button className="w-full" type="button">
                            <Send className="mr-2 h-4 w-4" />
                            Send 
                          </Button>
                        </Link>
                        <Button 
                          className="flex-1" 
                          type="button" 
                          variant="outline"
                          onClick={() => setTxHistoryOpen(true)}
                        >
                          <History className="mr-2 h-4 w-4" />
                          History
                        </Button>
                        <Button 
                          className="flex-1 bg-[#d66a03] hover:bg-[#f87c04] text-white" 
                          type="button" 
                          onClick={() => setReceiveOpen(true)}
                        >
                          <QrCode className="mr-2 h-4 w-4" />
                          Receive
                        </Button>
                      </CardFooter>
                    </div>
                  </Card>
              )}
              {activeAccount.accountAddress && (
                <div className="relative z-10">
                  <TokenForm />
                </div>
              )}
              {isConnected ? <AccountCreateImport /> : <ConnectionFailed />}
            </div>
          </>
        )}
      </div>
      {activeAccount.accountAddress && (
        <>
          <TransactionHistoryPopup
            accountAddress={activeAccount.accountAddress}
            blockchain={blockchain}
            isOpen={txHistoryOpen}
            onClose={() => setTxHistoryOpen(false)}
          />
          <ReceivePopup
            accountAddress={activeAccount.accountAddress}
            isOpen={receiveOpen}
            onClose={() => setReceiveOpen(false)}
          />
        </>
      )}
    </>
  );
});

export default Home;
