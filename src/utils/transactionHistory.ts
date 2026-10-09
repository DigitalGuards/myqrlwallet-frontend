import { z } from "zod";
import { isRecord } from "@/utils/guards";
import { receiptExecutionStatus } from "@/utils/web3/txPolling";
import { formatUnits } from "@/utils/web3/units";

const text = z.string().max(512);
const decimal = z
  .string()
  .max(100)
  .regex(/^\d+(?:\.\d+)?$/);
const address = z.string().regex(/^q[0-9a-f]{128}$/i);
const quantity = z
  .string()
  .max(80)
  .regex(/^(?:0x[0-9a-f]+|\d+)$/i);

export const localTransactionSchema = z
  .object({
    blockchain: z.enum(["TEST_NET", "TEST_NET_V3", "MAIN_NET"]),
    from: address,
    to: z.union([address, z.literal("")]),
    hash: z
      .string()
      .regex(/^0x[0-9a-f]{64}$/i)
      .transform((hash) => hash.toLowerCase()),
    amount: decimal,
    asset: z.string().min(1).max(100),
    submittedAt: z.number().int().nonnegative().max(8640000000000000),
    nonce: quantity.nullable(),
    state: z.enum(["pending", "confirmed", "failed", "dropped"]),
    blockNumber: z.union([quantity, z.literal("")]),
    paidFees: decimal.nullable(),
  })
  .refine((tx) =>
    tx.state === "confirmed" || tx.state === "failed"
      ? tx.blockNumber !== ""
      : tx.blockNumber === "",
  );

export type LocalTransaction = z.infer<typeof localTransactionSchema>;

const historyRowSchema = z.object({
  ID: text.min(1),
  InOut: z.union([z.literal(0), z.literal(1)]),
  TxType: text,
  Address: text,
  From: text,
  To: text,
  TxHash: text.min(1),
  TimeStamp: quantity,
  Amount: decimal,
  PaidFees: decimal.optional(),
  BlockNumber: quantity,
  Status: z.unknown().optional(),
  IsInternal: z.boolean().optional(),
});

export type HistoryRow = z.infer<typeof historyRowSchema> & {
  state?: LocalTransaction["state"];
  asset?: string;
};

export function parseHistoryResponse(value: unknown): HistoryRow[] {
  const result = z
    .object({ transactions: z.array(historyRowSchema) })
    .safeParse(value);
  if (!result.success) throw new Error("Invalid transaction history response");
  return result.data.transactions.map((row) => {
    const succeeded = receiptExecutionStatus(row.Status);
    return {
      ...row,
      ...(succeeded === undefined
        ? {}
        : { state: succeeded ? "confirmed" : "failed" }),
    };
  });
}

export function unsignedQuantity(value: unknown): bigint | null {
  if (typeof value === "bigint") return value >= 0n ? value : null;
  if (typeof value === "number")
    return Number.isSafeInteger(value) && value >= 0 ? BigInt(value) : null;
  return quantity.safeParse(value).success && typeof value === "string"
    ? BigInt(value)
    : null;
}

export function historyHash(value: unknown): string | null {
  if (value instanceof Uint8Array && value.length === 32) {
    return `0x${Array.from(value, (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
  }
  return typeof value === "string" && /^0x[0-9a-f]{64}$/i.test(value)
    ? value.toLowerCase()
    : null;
}

export function receiptUpdate(
  value: unknown,
  hash: string,
): Pick<LocalTransaction, "state" | "blockNumber" | "paidFees"> | null {
  if (
    !isRecord(value) ||
    historyHash(value["transactionHash"]) !== hash.toLowerCase()
  )
    return null;
  const succeeded = receiptExecutionStatus(value["status"]);
  const block = unsignedQuantity(value["blockNumber"]);
  if (succeeded === undefined || block === null) return null;
  const gas = unsignedQuantity(value["gasUsed"]);
  const price = unsignedQuantity(value["effectiveGasPrice"]);
  return {
    state: succeeded ? "confirmed" : "failed",
    blockNumber: block.toString(),
    paidFees: gas === null || price === null ? null : formatUnits(gas * price),
  };
}

/** A local send and its indexed outer transaction occupy one row. */
export function mergeHistory(
  backend: HistoryRow[],
  local: LocalTransaction[],
): HistoryRow[] {
  const rows = new Map(
    backend.map((row) => [
      `${row.TxHash.toLowerCase()}:${row.IsInternal ? row.ID : "outer"}`,
      row,
    ]),
  );
  for (const tx of local) {
    const key = `${tx.hash}:outer`;
    const indexed = rows.get(key);
    rows.set(key, {
      ID: tx.hash,
      InOut: 0,
      TxType: "0x2",
      Address: tx.from,
      From: tx.from,
      TxHash: tx.hash,
      TimeStamp: `0x${Math.floor(tx.submittedAt / 1000).toString(16)}`,
      BlockNumber: tx.blockNumber,
      ...(tx.paidFees === null ? {} : { PaidFees: tx.paidFees }),
      ...indexed,
      // Preserve the reviewed amount and recipient from the broadcast.
      Amount: tx.amount,
      To: tx.to,
      state: indexed?.state ?? tx.state,
      asset: tx.asset,
    });
  }
  return [...rows.values()].sort((a, b) =>
    Number(BigInt(b.TimeStamp) - BigInt(a.TimeStamp)),
  );
}

export function historyStatus(row: HistoryRow): string {
  switch (row.state) {
    case "pending":
      return "Pending";
    case "confirmed":
      return "Confirmed";
    case "failed":
      return "Failed";
    case "dropped":
      return "Failed (dropped or replaced)";
    default:
      return "Unavailable";
  }
}
