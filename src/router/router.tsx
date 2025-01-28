import { createBrowserRouter, RouterProvider, Navigate } from "react-router-dom";
import { lazy, Suspense } from "react";
import CreateToken from "@/components/ZondWallet/Body/CreateToken/CreateToken.tsx";
import SendToken from "@/components/ZondWallet/Body/SendTokens/SendToken.tsx";

// Lazy load components
const ZondWallet = lazy(() => import("../components/ZondWallet/ZondWallet.tsx"));
const Home = lazy(() => import("../components/ZondWallet/Body/Home/Home.tsx"));
const CreateAccount = lazy(() => import("../components/ZondWallet/Body/CreateAccount/CreateAccount.tsx"));
const ImportAccount = lazy(() => import("../components/ZondWallet/Body/ImportAccount/ImportAccount.tsx"));
const AccountDetails = lazy(() => import("../components/ZondWallet/Body/AccountDetails/AccountDetails.tsx"));
const AccountList = lazy(() => import("../components/ZondWallet/Body/AccountList/AccountList.tsx"));

const ROUTES = {
  HOME: "/",
  CREATE_ACCOUNT: "/create-account",
  IMPORT_ACCOUNT: "/import-account",
  ACCOUNT_LIST: "/account-list",
  ACCOUNT_DETAILS: "/account-details",
  CREATE_TOKEN: "/create-token",
  SEND_TOKEN: "/send-token",
  DEFAULT: "*",
} as const;

const router = createBrowserRouter([
  {
    path: ROUTES.HOME,
    element: (
      <Suspense fallback={<div>Loading...</div>}>
        <ZondWallet />
      </Suspense>
    ),
    children: [
      {
        index: true,
        element: (
          <Suspense fallback={<div>Loading...</div>}>
            <Home />
          </Suspense>
        ),
      },
      {
        path: ROUTES.CREATE_ACCOUNT,
        element: (
          <Suspense fallback={<div>Loading...</div>}>
            <CreateAccount />
          </Suspense>
        ),
      },
      {
        path: ROUTES.IMPORT_ACCOUNT,
        element: (
          <Suspense fallback={<div>Loading...</div>}>
            <ImportAccount />
          </Suspense>
        ),
      },
      {
        path: ROUTES.ACCOUNT_DETAILS,
        element: (
          <Suspense fallback={<div>Loading...</div>}>
            <AccountDetails />
          </Suspense>
        ),
      },
      {
        path: ROUTES.ACCOUNT_LIST,
        element: (
          <Suspense fallback={<div>Loading...</div>}>
            <AccountList />
          </Suspense>
        ),
      },
      {
        path: ROUTES.CREATE_TOKEN,
        element: (
          <Suspense fallback={<div>Loading...</div>}>
            <CreateToken />
          </Suspense>
        )
      },
      {
        path: ROUTES.SEND_TOKEN,
        element: (
          <Suspense fallback={<div>Loading...</div>}>
            <SendToken />
          </Suspense>
        )
      },
      {
        path: ROUTES.DEFAULT,
        element: <Navigate to={ROUTES.HOME} replace />
      },
    ],
  },
]);

export { ROUTES };

export const AppRouter = () => {
  return <RouterProvider router={router} />;
};
