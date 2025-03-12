import { createBrowserRouter, RouterProvider } from "react-router-dom";
import { lazy, Suspense } from "react";
import { Loading } from "@/components/UI/Loading";

// Lazy load components
const ZondWallet = lazy(() => import("../components/ZondWallet/ZondWallet.tsx"));
const Home = lazy(() => import("../components/ZondWallet/Body/Home/Home.tsx"));
const CreateAccount = lazy(() => import("../components/ZondWallet/Body/CreateAccount/CreateAccount.tsx"));
const ImportAccount = lazy(() => import("../components/ZondWallet/Body/ImportAccount/ImportAccount.tsx"));
const AddAccount = lazy(() => import("../components/ZondWallet/Body/AddAccount/AddAccount.tsx"))
const AccountDetails = lazy(() => import("../components/ZondWallet/Body/AccountDetails/AccountDetails.tsx"));
const AccountList = lazy(() => import("../components/ZondWallet/Body/AccountList/AccountList.tsx"));
const CreateToken = lazy(() => import("../components/ZondWallet/Body/CreateToken/CreateToken.tsx"));
// const Tokens = lazy(() => import("../components/ZondWallet/Body/Tokens/Tokens.tsx"))
const Settings = lazy(() => import("../components/ZondWallet/Body/Settings/Settings.tsx"));
const QRView = lazy(() => import("../components/ZondWallet/Body/QRView/QRView.tsx"));
const Terms = lazy(() => import("../components/ZondWallet/Body/Terms/Terms.tsx"));
const Privacy = lazy(() => import("../components/ZondWallet/Body/Privacy/Privacy.tsx"));
const Support = lazy(() => import("../components/ZondWallet/Body/Support/Support.tsx"));

const ROUTES = {
  HOME: "/",
  CREATE_ACCOUNT: "/create-account",
  IMPORT_ACCOUNT: "/import-account",
  ADD_ACCOUNT: "/add-account",
  ACCOUNT_LIST: "/account-list",
  ACCOUNT_DETAILS: "/account-details",
  CREATE_TOKEN: "/create-token",
  QR_VIEW: "/qr-view",
  SEND: "/send",
  // TOKENS: "/tokens",
  SETTINGS: "/settings",
  TERMS: "/terms",
  PRIVACY: "/privacy",
  SUPPORT: "/support",
  DEFAULT: "*",
} as const;

const router = createBrowserRouter([
  {
    path: ROUTES.HOME,
    element: (
      <Suspense fallback={<Loading />}>
        <ZondWallet />
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
        path: ROUTES.ACCOUNT_DETAILS,
        element: (
          <Suspense fallback={<Loading />}>
            <AccountDetails />
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
    ],
  },
  // Standalone routes outside the main layout
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
    path: ROUTES.SUPPORT,
    element: (
      <Suspense fallback={<Loading />}>
        <Support />
      </Suspense>
    ),
  },
]);

export { ROUTES };

export const AppRouter = () => {
  return <RouterProvider router={router} />;
};
