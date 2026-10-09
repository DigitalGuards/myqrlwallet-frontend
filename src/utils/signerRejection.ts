import { isRecord } from "@/utils/guards";

/** Recognize explicit signer refusal while preserving technical error codes. */
export function isUserRejection(error: unknown): boolean {
  if (isRecord(error) && error["code"] !== undefined) {
    return error["code"] === 4001;
  }
  const message =
    typeof error === "string"
      ? error
      : isRecord(error)
        ? error["message"]
        : undefined;
  if (typeof message !== "string") return false;
  return /^(?:user rejected(?: (?:the )?(?:request|transaction|signature))?|rejected by (?:the )?user|(?:request|transaction|signature) rejected by (?:the )?user|user denied(?: (?:the )?(?:request|transaction|signature|transaction signature))?|request rejected)[.!]?$/i.test(
    message.trim(),
  );
}
