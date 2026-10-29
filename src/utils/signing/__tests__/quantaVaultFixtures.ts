import typed from "../__fixtures__/quantaVault/typed-data-v2.json";
import approvals from "../__fixtures__/quantaVault/vault-approvals.json";
import calls from "../__fixtures__/quantaVault/calldata.json";
import { SignTypedDataParamsSchema } from "../types";

export const vaultTestAddress = `Q${"ab".repeat(64)}`;
export const vaultSchemeVectors = [
  ...typed.schemeVectors,
  ...approvals.schemeVectors,
];

export function vaultPayload(label = "empty-call") {
  const fixture = vaultSchemeVectors.find((vector) => vector.label === label);
  if (!fixture) throw new Error(`Missing vault fixture: ${label}`);
  // Parsing returns a fresh payload for each mutation test.
  return SignTypedDataParamsSchema.parse([
    vaultTestAddress,
    fixture.payload,
  ])[1];
}

export function vaultCalldata(method: string) {
  const fixture = calls.find((vector) => vector.method === method);
  if (!fixture) throw new Error(`Missing call fixture: ${method}`);
  return fixture;
}
