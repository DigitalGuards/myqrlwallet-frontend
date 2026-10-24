import "i18next";
import type english from "@/locales/en";

declare module "i18next" {
  interface CustomTypeOptions {
    defaultNS: "common";
    resources: typeof english;
    strictKeyChecks: true;
    returnNull: false;
  }
}
