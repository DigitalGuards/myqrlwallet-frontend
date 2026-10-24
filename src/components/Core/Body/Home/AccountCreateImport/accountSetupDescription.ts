import { isDesktop } from "@/desktop/bridge";
import { isInNativeApp } from "@/utils/nativeApp";

export function accountSetupDescription() {
  return isInNativeApp() || isDesktop
    ? ("home:setupLocal" as const)
    : ("home:setupWeb" as const);
}
