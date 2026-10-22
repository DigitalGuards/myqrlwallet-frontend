import { z } from "zod";

export const transferErrorSchema = z.object({
  key: z.enum([
    "transfer:decimals",
    "transfer:transactionFailed",
    "transfer:transferFailed",
  ]),
  count: z.number().optional(),
  digits: z.string().optional(),
  reason: z.string().optional(),
});
const prefix = "i18n-transfer:";

/** React Hook Form stores a string; retain meaning and interpolation until render. */
export function transferError(
  value: z.infer<typeof transferErrorSchema>,
): string {
  return prefix + JSON.stringify(value);
}

export function readTransferError(message: string) {
  if (!message.startsWith(prefix)) return null;
  try {
    const value: unknown = JSON.parse(message.slice(prefix.length));
    const parsed = transferErrorSchema.safeParse(value);
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
