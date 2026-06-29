import { createBrowserRouter, createHashRouter, RouterProvider } from "react-router-dom";
import { lazy, Suspense } from "react";
import { Loading } from "@/components/UI/Loading";
import { Navigate } from "react-router-dom";

// Kick off the two chunks needed on every page-load immediately so they
// download in parallel with the main bundle instead of sequentially.
const _myQrlWalletChunk = import("../components/Core/MyQRLWallet.tsx");
const _homeChunk = import("../components/Core/Body/Home/Home.tsx");

const MyQRLWallet = lazy(() => _myQrlWalletChunk);
const Home = lazy(() => _homeChunk);
const CreateAccount = lazy(() => import("../components/Core/Body/CreateAccount/CreateAccount.tsx"));
const ImportAccount = lazy(() => import("../components/Core/Body/ImportAccount/ImportAccount.tsx"));
const AddAccount = lazy(() => import("../components/Core/Body/AddAccount/AddAccount.tsx"))
const AccountList = lazy(() => import("../components/Core/Body/AccountList/AccountList.tsx"));
const CreateToken = lazy(() => import("../components/Core/Body/CreateToken/CreateToken.tsx"));
const Settings = lazy(() => import("../components/Core/Body/Settings/Settings.tsx"));
const QRView = lazy(() => import("../components/Core/Body/QRView/QRView.tsx"));
const Terms = lazy(() => import("../components/Core/Body/Terms/Terms.tsx"));
const Privacy = lazy(() => import("../components/Core/Body/Privacy/Privacy.tsx"));
const TokenStatus = lazy(() => import("../components/Core/Body/CreateToken/TokenStatus.tsx"));
const TransactionHistory = lazy(() => import("../components/Core/Body/TransactionHistory/TransactionHistory.tsx"));
const Transfer = lazy(() => import("../components/Core/Body/Transfer/Transfer.tsx"));
const DAppSessionsList = lazy(() => import("../components/Core/Body/DAppConnect/DAppSessionsList.tsx"));
const NftDetail = lazy(() => import("../components/Core/Body/Nfts/NftDetail.tsx"));

const ROUTES = {
  HOME: "/",
  CREATE_ACCOUNT: "/create-account",
  IMPORT_ACCOUNT: "/import-account",
  ADD_ACCOUNT: "/add-account",
  ACCOUNT_LIST: "/account-list",
  CREATE_TOKEN: "/create-token",
  QR_VIEW: "/qr-view",
  TRANSFER: "/transfer",
  SETTINGS: "/settings",
  TERMS: "/terms",
  PRIVACY: "/privacy",
  DEFAULT: "*",
  TOKEN_STATUS: "/token-status",
  TRANSACTION_HISTORY: "/tx-history",
  DAPP_SESSIONS: "/dapp-sessions",
  NFT_DETAIL: "/nft/:contractAddress/:tokenId",
} as const;

// Under the MyQRLWallet desktop shell the app is loaded from disk via
// loadFile (file:// origin), where the HTML5 history API does not work and
// deep links / reloads break. The desktop preload exposes `window.qrlWallet`,
// so we detect it at runtime and use hash routing there. Web builds are
// unchanged (no qrlWallet -> createBrowserRouter).
const isDesktopShell =
  typeof window !== "undefined" && Boolean((window as { qrlWallet?: unknown }).qrlWallet);
const createAppRouter = isDesktopShell ? createHashRouter : createBrowserRouter;

const router = createAppRouter([
  {
    path: ROUTES.HOME,
    element: (
      <Suspense fallback={<Loading />}>
        <MyQRLWallet />
      </Suspense>
    ),
    children: [
      {
        index: true,
        element: (
          <Suspense fallback={<Loading />}>
            <Home />
          </Suspense>
        ),
      },
      {
        path: ROUTES.CREATE_ACCOUNT,
        element: (
          <Suspense fallback={<Loading />}>
            <CreateAccount />
          </Suspense>
        ),
      },
      {
        path: ROUTES.IMPORT_ACCOUNT,
        element: (
          <Suspense fallback={<Loading />}>
            <ImportAccount />
          </Suspense>
        ),
      },
      {
        path: ROUTES.ADD_ACCOUNT,
        element: (
          <Suspense fallback={<Loading />}>
            <AddAccount />
          </Suspense>
        ),
      },
      {
        path: ROUTES.ACCOUNT_LIST,
        element: (
          <Suspense fallback={<Loading />}>
            <AccountList />
          </Suspense>
        ),
      },
      {
        path: ROUTES.CREATE_TOKEN,
        element: (
          <Suspense fallback={<Loading />}>
            <CreateToken />
          </Suspense>
        )
      },
      {
        path: ROUTES.QR_VIEW,
        element: (
          <Suspense fallback={<Loading />}>
            <QRView />
          </Suspense>
        )
      },
      {
        path: ROUTES.SETTINGS,
        element: (
          <Suspense fallback={<Loading />}>
            <Settings />
          </Suspense>
        ),
      },
      {
        path: ROUTES.TERMS,
        element: (
          <Suspense fallback={<Loading />}>
            <Terms />
          </Suspense>
        ),
      },
      {
        path: ROUTES.PRIVACY,
        element: (
          <Suspense fallback={<Loading />}>
            <Privacy />
          </Suspense>
        ),
      },
      {
        path: ROUTES.TOKEN_STATUS,
        element: (
          <Suspense fallback={<Loading />}>
            <TokenStatus />
          </Suspense>
        )
      },
      {
        path: ROUTES.TRANSACTION_HISTORY,
        element: (
          <Suspense fallback={<Loading />}>
            <TransactionHistory />
          </Suspense>
        )
      },
      {
        path: ROUTES.TRANSFER,
        element: (
          <Suspense fallback={<Loading />}>
            <Transfer />
          </Suspense>
        )
      },
      {
        path: ROUTES.DAPP_SESSIONS,
        element: (
          <Suspense fallback={<Loading />}>
            <DAppSessionsList />
          </Suspense>
        )
      },
      {
        path: ROUTES.NFT_DETAIL,
        element: (
          <Suspense fallback={<Loading />}>
            <NftDetail />
          </Suspense>
        )
      },
      {
        path: ROUTES.DEFAULT,
        element: (
          <Suspense fallback={<Loading />}>
            <Navigate to={ROUTES.HOME} replace />
          </Suspense>
        )
      },
    ],
  },
]);

export { ROUTES };

export const AppRouter = () => {
  return <RouterProvider router={router} />;
};
