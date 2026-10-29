import { runInThisContext } from "node:vm";
import typed from "../__fixtures__/quantaVault/typed-data-v2.json";
import approvals from "../__fixtures__/quantaVault/vault-approvals.json";
import calls from "../__fixtures__/quantaVault/calldata.json";
import review from "../__fixtures__/quantaVault/review-cases.json";
import { SignTypedDataParamsSchema } from "../types";
import { isRecord } from "@/utils/guards";

export const vaultTestAddress = `Q${"ab".repeat(64)}`;
export const vaultSchemeVectors = [
  ...typed.schemeVectors,
  ...approvals.schemeVectors,
];
export const vaultReviewVectors = review.cases;
export const vaultReviewTime = BigInt(review.reviewTime);
// Use Node's native structuredClone in both Node and jsdom test environments.
const structuredClone: unknown = runInThisContext("structuredClone");

export function vaultPayload(label = "empty-call") {
  const reviewCase = vaultReviewVectors.find(
    (vector) => vector.label === label,
  );
  const fixture = vaultSchemeVectors.find(
    (vector) => vector.label === (reviewCase?.baseLabel ?? label),
  );
  if (!fixture) throw new Error(`Missing vault fixture: ${label}`);
  if (typeof structuredClone !== "function")
    throw new Error("Missing structuredClone");
  // Record parsing is shallow, so clone nested transactions before mutation tests.
  const payload = SignTypedDataParamsSchema.parse([
    vaultTestAddress,
    Reflect.apply(structuredClone, undefined, [fixture.payload]),
  ])[1];
  if (reviewCase) {
    const tx =
      payload.primaryType === "VaultApproval"
        ? payload.message["tx"]
        : payload.message;
    if (!isRecord(tx)) throw new Error("Missing vault transaction");
    Object.assign(tx, reviewCase.tx);
  }
  return payload;
}

export function vaultCalldata(method: string) {
  const fixture = calls.find((vector) => vector.method === method);
  if (!fixture) throw new Error(`Missing call fixture: ${method}`);
  return fixture;
}
