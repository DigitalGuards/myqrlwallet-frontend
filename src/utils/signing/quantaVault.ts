import { isRecord } from "@/utils/guards";
import { isValidQrlAddress, QRL_ZERO_ADDRESS } from "@/utils/web3/address";
import type { StructDef, TypedDataPayload } from "./typedData";

export const VAULT_DOMAIN_FIELDS: StructDef = [
  { name: "name", type: "string" },
  { name: "version", type: "string" },
  { name: "chainId", type: "uint256" },
  { name: "verifyingContract", type: "address" },
];
export const VAULT_TX_FIELDS: StructDef = [
  { name: "to", type: "address" },
  { name: "value", type: "uint256" },
  { name: "data", type: "bytes" },
  { name: "operation", type: "uint8" },
  { name: "txGas", type: "uint256" },
  { name: "baseGas", type: "uint256" },
  { name: "gasPrice", type: "uint256" },
  { name: "gasToken", type: "address" },
  { name: "refundReceiver", type: "address" },
  { name: "nonce", type: "uint256" },
  { name: "validUntil", type: "uint256" },
];
const MESSAGE_FIELDS: StructDef = [{ name: "message", type: "bytes" }];
const APPROVAL_FIELDS: StructDef = [
  { name: "vault", type: "address" },
  { name: "tx", type: "VaultTx" },
];

export const VAULT_MAX_UINT256 = (1n << 256n) - 1n;

export interface VaultTransaction {
  to: string;
  value: bigint;
  data: string;
  operation: bigint;
  txGas: bigint;
  baseGas: bigint;
  gasPrice: bigint;
  gasToken: string;
  refundReceiver: string;
  nonce: bigint;
  validUntil: bigint;
}

interface VaultDomain {
  vault: string;
  chainId: bigint;
}
export type VaultRequest = VaultDomain &
  (
    | { kind: "VaultTx"; tx: VaultTransaction }
    | { kind: "VaultApproval"; outerVault: string; tx: VaultTransaction }
    | { kind: "VaultMessage"; message: string }
  );

function exactFields(
  actual: StructDef | undefined,
  expected: StructDef,
): boolean {
  return (
    actual?.length === expected.length &&
    expected.every((field, index) => {
      const candidate = actual[index];
      return candidate?.name === field.name && candidate.type === field.type;
    })
  );
}

export function vaultUint(value: unknown, bits = 256): bigint {
  if (
    typeof value !== "string" &&
    typeof value !== "number" &&
    typeof value !== "bigint"
  )
    throw new Error("Invalid vault integer");
  if (typeof value === "number" && !Number.isSafeInteger(value))
    throw new Error("Unsafe vault integer");
  if (
    typeof value === "string" &&
    (value.length > 80 || !/^-?(?:0x[0-9a-f]+|0|[1-9][0-9]*)$/i.test(value))
  )
    throw new Error("Invalid vault integer");
  const negative = typeof value === "string" && value.startsWith("-");
  const parsed = negative ? -BigInt(value.slice(1)) : BigInt(value);
  if (parsed < 0n || parsed >= 1n << BigInt(bits))
    throw new Error("Vault integer out of range");
  return parsed;
}

function address(value: unknown): string {
  if (typeof value !== "string" || !isValidQrlAddress(value))
    throw new Error("Invalid vault address");
  return value;
}
function bytes(value: unknown): string {
  if (
    typeof value !== "string" ||
    value.length > 32770 ||
    !/^0x(?:[0-9a-f]{2})*$/i.test(value)
  )
    throw new Error("Invalid vault bytes");
  return value;
}

function transaction(value: unknown): VaultTransaction {
  if (!isRecord(value) || Object.keys(value).length !== VAULT_TX_FIELDS.length)
    throw new Error("Invalid vault transaction");
  return {
    to: address(value["to"]),
    value: vaultUint(value["value"]),
    data: bytes(value["data"]),
    operation: vaultUint(value["operation"], 8),
    txGas: vaultUint(value["txGas"]),
    baseGas: vaultUint(value["baseGas"]),
    gasPrice: vaultUint(value["gasPrice"]),
    gasToken: address(value["gasToken"]),
    refundReceiver: address(value["refundReceiver"]),
    nonce: vaultUint(value["nonce"]),
    validUntil: vaultUint(value["validUntil"]),
  };
}

/** Recognition follows field identity and order, independently of encodeType strings. */
export function recognizeVaultRequest(
  payload: TypedDataPayload,
): VaultRequest | null {
  const { types, domain, message, primaryType } = payload;
  if (
    domain["name"] !== "QuantaVault" ||
    domain["version"] !== "1" ||
    Object.keys(domain).length !== 4 ||
    !exactFields(types["QRLDomain"], VAULT_DOMAIN_FIELDS)
  )
    return null;
  const expected =
    primaryType === "VaultTx"
      ? VAULT_TX_FIELDS
      : primaryType === "VaultMessage"
        ? MESSAGE_FIELDS
        : primaryType === "VaultApproval"
          ? APPROVAL_FIELDS
          : undefined;
  if (
    !expected ||
    !exactFields(types[primaryType], expected) ||
    Object.keys(types).length !== (primaryType === "VaultApproval" ? 3 : 2) ||
    Object.keys(message).length !== expected.length ||
    (primaryType === "VaultApproval" &&
      !exactFields(types["VaultTx"], VAULT_TX_FIELDS))
  )
    return null;
  try {
    const shared = {
      vault: address(domain["verifyingContract"]),
      chainId: vaultUint(domain["chainId"]),
    };
    if (primaryType === "VaultMessage")
      return {
        ...shared,
        kind: primaryType,
        message: bytes(message["message"]),
      };
    if (primaryType === "VaultApproval")
      return {
        ...shared,
        kind: primaryType,
        outerVault: address(message["vault"]),
        tx: transaction(message["tx"]),
      };
    return { ...shared, kind: "VaultTx", tx: transaction(message) };
  } catch {
    return null;
  }
}

export function hasVaultRefund(tx: VaultTransaction): boolean {
  return (
    tx.baseGas !== 0n ||
    tx.gasPrice !== 0n ||
    tx.gasToken.toLowerCase() !== QRL_ZERO_ADDRESS.toLowerCase() ||
    tx.refundReceiver.toLowerCase() !== QRL_ZERO_ADDRESS.toLowerCase()
  );
}

/** Shared by the rendered button and the signing entry point. */
export function vaultApprovalBlocked(payload: TypedDataPayload): boolean {
  const request = recognizeVaultRequest(payload);
  return (
    request !== null &&
    request.kind !== "VaultMessage" &&
    hasVaultRefund(request.tx)
  );
}
