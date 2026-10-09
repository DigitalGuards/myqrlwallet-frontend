import { isCallable, isRecord } from "@/utils/guards";

/** Validate the dynamically generated contract method before using its calldata. */
export function encodeTokenTransfer(
  methods: unknown,
  to: string,
  amount: string,
): string {
  if (!isRecord(methods) || !isCallable(methods["transfer"])) {
    throw new Error("Token transfer method is unavailable.");
  }
  const call: unknown = methods["transfer"](to, amount);
  if (!isRecord(call) || !isCallable(call["encodeABI"])) {
    throw new Error("Token transfer encoding is unavailable.");
  }
  const data: unknown = call["encodeABI"]();
  if (typeof data !== "string" || !/^0x(?:[0-9a-f]{2})+$/i.test(data)) {
    throw new Error("Token transfer encoding is invalid.");
  }
  return data;
}
