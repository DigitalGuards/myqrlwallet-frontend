import { withSuspense } from "@/utils/react";
import { useStore } from "../../../../stores/store";
import { Loader, Send, History, QrCode, ScanLine } from "lucide-react";
import { observer } from "mobx-react-lite";
import { lazy, useEffect, useRef, useState } from "react";
import ConnectionFailed from "./ConnectionFailed/ConnectionFailed";
import { SEO } from "../../../SEO/SEO";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/UI/Card";
import { Button } from "@/components/UI/Button";
import { ROUTES } from "@/router/router";
import { ActiveAccountDisplay } from "./AccountCreateImport/ActiveAccountDisplay/ActiveAccountDisplay";
import { Link } from "react-router";
import { TransactionHistoryPopup } from "../AccountList/ActiveAccount/TransactionHistoryPopup";
import { ReceivePopup } from "./ReceivePopup";
import { isInNativeApp, requestQRScan } from "@/utils/nativeApp";
import ConnectionBadge from "./ConnectionBadge/ConnectionBadge";
import { StorageUtil, STORAGE_EVENT_WALLET_SETTINGS } from "@/utils/storage";

const AccountCreateImport = withSuspense(
  lazy(() => import("./AccountCreateImport/AccountCreateImport"))
);
import BackgroundVideo from "./BackgroundVideo/BackgroundVideo";
import DecorativeAccountVideo from "./DecorativeAccountVideo";

const TokenForm = withSuspense(
  lazy(() => import("../Tokens/TokenForm/TokenForm"))
);

const NftGallery = withSuspense(
  lazy(() => import("../Nfts/NftGallery"))
);

const Home = observer(() => {
  const { qrlStore, tokenStore } = useStore();
  const { qrlConnection, activeAccount } = qrlStore;
  const { isLoading, isConnected, blockchain } = qrlConnection;
  const refreshIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const [txHistoryOpen, setTxHistoryOpen] = useState(false);
  const [receiveOpen, setReceiveOpen] = useState(false);
  const [showTokensCard, setShowTokensCard] = useState(true);
  const [showNftsCard, setShowNftsCard] = useState(true);

  // Load card-visibility prefs and refresh whenever Settings re-saves
  // (StorageUtil dispatches STORAGE_EVENT_WALLET_SETTINGS on write so
  // toggles take effect without a page reload).
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const s = await StorageUtil.getWalletSettings();
      if (cancelled) return;
      setShowTokensCard(s.showTokensCard ?? true);
      setShowNftsCard(s.showNftsCard ?? true);
    };
    load();
    const handler = () => { load(); };
    window.addEventListener(STORAGE_EVENT_WALLET_SETTINGS, handler);
    return () => {
      cancelled = true;
      window.removeEventListener(STORAGE_EVENT_WALLET_SETTINGS, handler);
    };
  }, []);

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
      qrlStore.fetchAccounts();
      tokenStore.refreshTokenBalances();
      qrlStore.fetchQrlPrice();

      // Set up recurring refresh every 30 seconds
      refreshIntervalRef.current = setInterval(() => {
        // Only refresh if no modals are open
        if (!checkIfModalOpen()) {
          qrlStore.fetchAccounts();
          tokenStore.refreshTokenBalances();
          qrlStore.fetchQrlPrice();
        }
      }, 30000); // 30 seconds
    }

    return () => {
      if (refreshIntervalRef.current) {
        clearInterval(refreshIntervalRef.current);
      }
    };
  }, [activeAccount.accountAddress, qrlStore, tokenStore]);

  return (
    <>
      <SEO
        title="Home"
        description="Welcome to the QRL 2.0 Web Wallet. Create or import your quantum-resistant wallet and start managing your QRL assets securely."
        keywords="QRL Wallet, Create Wallet, Import Wallet, Quantum Resistant, Web3"
      />
      <BackgroundVideo />
      <div className="relative z-10 mx-auto flex max-w-2xl flex-col items-center gap-2 md:gap-4 md:py-4">
        <div className="relative flex w-full items-center justify-end px-4 pt-2 md:pt-0">
          {isInNativeApp() && (
            <button
              onClick={() => requestQRScan()}
              className="absolute left-4 rounded-full p-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              aria-label="Scan QR code"
            >
              <ScanLine className="h-6 w-6" />
            </button>
          )}
          <ConnectionBadge />
        </div>
        {isLoading ? (
          <Loader className="animate-spin text-foreground" size={32} />
        ) : (
          <>

            <div className="page-enter flex w-full flex-col gap-4 md:gap-8">
              {activeAccount.accountAddress && (
                <Card className="w-full relative overflow-hidden surface-ember">
                  <DecorativeAccountVideo />
                  <div className="relative z-10">
                    <CardHeader className="bg-gradient-to-r from-primary/10 to-transparent">
                      <CardTitle className="text-2xl font-bold">Active account</CardTitle>
                      </CardHeader>
                      <CardContent>
                        <ActiveAccountDisplay onShowAddress={() => setReceiveOpen(true)} />
                      </CardContent>
                      <CardFooter className="justify-end gap-2">
                        <Link className="flex-1" to={ROUTES.TRANSFER}>
                          <Button className="w-full" type="button">
                            <Send className="mr-2 h-4 w-4" />
                            Transfer
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
                          className="flex-1"
                          type="button"
                          variant="secondary"
                          onClick={() => setReceiveOpen(true)}
                        >
                          <QrCode className="mr-2 h-4 w-4" />
                          Receive
                        </Button>
                      </CardFooter>
                    </div>
                  </Card>
              )}
              {activeAccount.accountAddress && showTokensCard && (
                <div className="relative z-10">
                  <TokenForm />
                </div>
              )}
              {activeAccount.accountAddress && showNftsCard && (
                <div className="relative z-10">
                  <NftGallery />
                </div>
              )}
              {!isConnected ? (
                <ConnectionFailed />
              ) : (
                !activeAccount.accountAddress && <AccountCreateImport />
              )}
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
