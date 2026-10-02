import { useSyncExternalStore } from "react";
import {
  hasNativeInjectedPin,
  subscribeNativeInjectedPin,
} from "@/utils/nativeApp";

/**
 * Whether the native app has injected the wallet PIN after Device Login.
 * Re-renders when the PIN arrives or is cleared.
 */
export function useHasNativeInjectedPin(): boolean {
  return useSyncExternalStore(subscribeNativeInjectedPin, hasNativeInjectedPin);
}
