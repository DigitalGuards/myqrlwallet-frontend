export const serverUrl = import.meta.env.PROD
  ? (import.meta.env.VITE_SERVER_URL_PRODUCTION ?? "/api")
  : (import.meta.env.VITE_SERVER_URL_DEVELOPMENT ??
    "http://localhost:3000/api");
