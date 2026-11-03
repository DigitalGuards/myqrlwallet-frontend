/**
 * Every wallet route path.
 *
 * This module imports nothing, so code that only needs the paths (the Back
 * parent table, for one) can use them without building the router, which
 * router.tsx does as soon as it is imported.
 */
export const ROUTES = {
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
  DISCLAIMER: "/disclaimer",
  LEGAL: "/legal",
  SECURITY: "/security",
  DEFAULT: "*",
  TOKEN_STATUS: "/token-status",
  TRANSACTION_HISTORY: "/tx-history",
  DAPP_SESSIONS: "/dapp-sessions",
  ADDRESS_BOOK: "/address-book",
  NFT_DETAIL: "/nft/:contractAddress/:tokenId",
  TELEGRAM: "/telegram",
} as const;

/** One of the route paths above. */
export type RoutePath = (typeof ROUTES)[keyof typeof ROUTES];
