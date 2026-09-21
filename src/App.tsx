import { store, StoreProvider } from "./stores/store";
import { AppRouter } from "./router/router";
import {
  isUnsupportedV3Context,
  V3_UNSUPPORTED_SIGNER_MESSAGE,
} from "./config/runtimeProfile";
import { useEffect, useState } from "react";

function App() {
  const [unsupported, setUnsupported] = useState(isUnsupportedV3Context);
  useEffect(() => {
    if (
      !unsupported ||
      (!window.ReactNativeWebView &&
        !navigator.userAgent.includes("MyQRLWallet"))
    )
      return;
    // Android may expose the injected capability object after the first render.
    // Keep wallet operations gated while waiting for the exact native profile.
    let attempts = 0;
    const timer = window.setInterval(() => {
      if (!isUnsupportedV3Context()) {
        window.clearInterval(timer);
        void store.qrlStore.initializeBlockchain();
        setUnsupported(false);
      } else if (++attempts >= 100) {
        window.clearInterval(timer);
      }
    }, 100);
    return () => window.clearInterval(timer);
  }, [unsupported]);

  if (unsupported) {
    return (
      <main className="p-8">
        <h1>Update MyQRLWallet for Testnet v3</h1>
        <p>{V3_UNSUPPORTED_SIGNER_MESSAGE}</p>
        <p>
          Install the latest app, or open this site in a regular browser to
          create or import a v3 account.
        </p>
      </main>
    );
  }
  return (
    <div className="h-full w-full">
      <StoreProvider value={store}>
        <AppRouter />
      </StoreProvider>
    </div>
  );
}

export default App;
