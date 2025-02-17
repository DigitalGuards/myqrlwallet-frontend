import { createBrowserRouter, RouterProvider, Navigate } from "react-router-dom";
import { lazy, Suspense } from "react";

// Lazy load components
const ZondWallet = lazy(() => import("../components/ZondWallet/ZondWallet.tsx"));
const Home = lazy(() => import("../components/ZondWallet/Body/Home/Home.tsx"));
const CreateAccount = lazy(() => import("../components/ZondWallet/Body/CreateAccount/CreateAccount.tsx"));
const ImportAccount = lazy(() => import("../components/ZondWallet/Body/ImportAccount/ImportAccount.tsx"));
const AddAccount = lazy(() => import("../components/ZondWallet/Body/AddAccount/AddAccount.tsx"))
const AccountDetails = lazy(() => import("../components/ZondWallet/Body/AccountDetails/AccountDetails.tsx"));
const AccountList = lazy(() => import("../components/ZondWallet/Body/AccountList/AccountList.tsx"));
const CreateToken = lazy(() => import("../components/ZondWallet/Body/CreateToken/CreateToken.tsx"));
const Tokens = lazy(() => import("../components/ZondWallet/Body/Tokens/Tokens.tsx"))

const ROUTES = {
  HOME: "/",
  CREATE_ACCOUNT: "/create-account",
  IMPORT_ACCOUNT: "/import-account",
  ADD_ACCOUNT: "/add-account",
  ACCOUNT_LIST: "/account-list",
  ACCOUNT_DETAILS: "/account-details",
  CREATE_TOKEN: "/create-token",
  TOKENS: "/tokens",
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
        path: ROUTES.ADD_ACCOUNT,
        element: (
          <Suspense fallback={<div>Loading...</div>}>
            <AddAccount />
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
        path: ROUTES.TOKENS,
        element: (
          <Suspense fallback={<div>Loading...</div>}>
            <Tokens />
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
