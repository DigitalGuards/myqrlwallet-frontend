import { useTranslation } from "react-i18next";
import { useLanguagePreference } from "@/i18n/useLanguagePreference";
import { store, StoreProvider } from "./stores/store";
import { AppRouter } from "./router/router";
import { isUnsupportedV3Context } from "./config/runtimeProfile";
import { useEffect, useState } from "react";

function App() {
  useLanguagePreference();
  const { t } = useTranslation("notices");
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
    return () => {
      window.clearInterval(timer);
    };
  }, [unsupported]);

  if (unsupported) {
    return (
      <main className="p-8">
        <h1>{t("updateV3")}</h1>
        <p>{t("unsupportedV3")}</p>
        <p>{t("installV3")}</p>
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
