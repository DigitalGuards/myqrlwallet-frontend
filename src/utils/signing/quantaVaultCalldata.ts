import {
  QUANTA_VAULT_CONFIG,
  type QuantaVaultConfig,
} from "@/config/quantaVault";
import { QRL_ZERO_ADDRESS } from "@/utils/web3/address";
import { VAULT_ROLES, VAULT_SELECTORS } from "./quantaVaultSelectors";

export type VaultAbiType =
  (typeof VAULT_SELECTORS)[number]["inputs"][number]["type"];
export type VaultAbiValue = string | bigint | readonly VaultAbiValue[];
export interface VaultArgument {
  name: string;
  type: VaultAbiType;
  value: VaultAbiValue;
}
export type VaultCallWarning =
  | "unknownCalldata"
  | "invalidCalldata"
  | "depthLimit"
  | "securityChange"
  | "delegateCall"
  | "opaqueApproval"
  | "openRole";
export interface VaultCall {
  to: string;
  value: bigint;
  operation: bigint;
  data: string;
}
export interface DecodedVaultCall extends VaultCall {
  status: "decoded" | "empty" | "unknown" | "invalid";
  method?: string;
  args: readonly VaultArgument[];
  warnings: readonly VaultCallWarning[];
  children: readonly DecodedVaultCall[];
}

const WORD = 64;
const MAX_BYTES = 16 * 1024;
const SECURITY_METHODS = new Set([
  "addOwnerWithThreshold",
  "removeOwner",
  "swapOwner",
  "changeThreshold",
  "enableModule",
  "disableModule",
  "setGuard",
  "setModuleGuard",
  "setFallbackHandler",
  "grantRole",
  "revokeRole",
  "renounceRole",
  "transferOwnership",
  "acceptOwnership",
  "renounceOwnership",
]);

/** QRVM offsets, lengths, addresses and padding each use 64-byte words. */
class AbiReader {
  readonly size: number;
  constructor(private readonly hex: string) {
    if (hex.length > MAX_BYTES * 2 || !/^(?:[0-9a-f]{2})*$/i.test(hex))
      throw new Error("Invalid ABI bytes");
    this.size = hex.length / 2;
  }
  slice(offset: number, length: number): string {
    if (
      !Number.isSafeInteger(offset) ||
      !Number.isSafeInteger(length) ||
      offset < 0 ||
      length < 0 ||
      offset + length > this.size
    )
      throw new Error("Truncated ABI value");
    return this.hex.slice(offset * 2, (offset + length) * 2).toLowerCase();
  }
  word(offset: number): bigint {
    return BigInt(`0x${this.slice(offset, WORD)}`);
  }
  sizeWord(offset: number): number {
    const value = this.word(offset);
    if (value > BigInt(this.size)) throw new Error("ABI length exceeds input");
    return Number(value);
  }
  tuple(
    types: readonly VaultAbiType[],
    start: number,
  ): { values: VaultAbiValue[]; end: number } {
    let end = start + types.length * WORD;
    this.slice(start, types.length * WORD);
    const values = types.map((type, index) => {
      const head = start + index * WORD;
      const dynamic = type === "bytes" || type.endsWith("[]");
      if (!dynamic) return this.atomic(type, head);
      // Only a complete canonical tuple receives a decoded presentation.
      // This also rejects overlapping tails and offsets into the head.
      if (this.sizeWord(head) !== end - start)
        throw new Error("Noncanonical ABI offset");
      const decoded = this.dynamic(type, end);
      end = decoded.end;
      return decoded.value;
    });
    return { values, end };
  }
  private atomic(type: VaultAbiType, offset: number): VaultAbiValue {
    if (type === "address") return `Q${this.slice(offset, WORD)}`;
    if (type === "bytes64") return `0x${this.slice(offset, WORD)}`;
    if (type === "bytes32") {
      if (!/^0*$/.test(this.slice(offset + 32, 32)))
        throw new Error("Nonzero bytes32 padding");
      return `0x${this.slice(offset, 32)}`;
    }
    if (type === "uint8" || type === "uint256") {
      const value = this.word(offset);
      if (value >= 1n << BigInt(type === "uint8" ? 8 : 256))
        throw new Error("ABI integer overflow");
      return value;
    }
    throw new Error("Unsupported ABI atom");
  }
  private dynamic(
    type: VaultAbiType,
    offset: number,
  ): { value: VaultAbiValue; end: number } {
    const length = this.sizeWord(offset);
    const start = offset + WORD;
    if (type === "bytes") {
      const padded = Math.ceil(length / WORD) * WORD;
      const value = `0x${this.slice(start, length)}`;
      if (!/^0*$/.test(this.slice(start + length, padded - length)))
        throw new Error("Nonzero ABI padding");
      return { value, end: start + padded };
    }
    const inner =
      type === "address[]"
        ? "address"
        : type === "uint256[]"
          ? "uint256"
          : "bytes";
    if (length > Math.floor((this.size - start) / WORD))
      throw new Error("Truncated ABI array");
    const tuple = this.tuple(
      Array.from({ length }, () => inner),
      start,
    );
    return { value: tuple.values, end: tuple.end };
  }
}

export function decodeVaultAbi(
  types: readonly VaultAbiType[],
  data: string,
): VaultAbiValue[] {
  if (!data.startsWith("0x")) throw new Error("Missing ABI prefix");
  const reader = new AbiReader(data.slice(2));
  const decoded = reader.tuple(types, 0);
  if (decoded.end !== reader.size) throw new Error("Trailing ABI bytes");
  return decoded.values;
}

/** Mirrors the SDK's packed entry decoder, including its full-width value word. */
export function decodeVaultMultiSend(data: string): VaultCall[] {
  if (!data.startsWith("0x")) throw new Error("Missing batch prefix");
  const reader = new AbiReader(data.slice(2));
  const calls: VaultCall[] = [];
  let offset = 0;
  while (offset < reader.size) {
    reader.slice(offset, 193);
    const operation = BigInt(`0x${reader.slice(offset, 1)}`);
    if (operation !== 0n && operation !== 1n)
      throw new Error("Invalid batch operation");
    const to = `Q${reader.slice(offset + 1, 64)}`;
    const value = reader.word(offset + 65);
    const length = reader.sizeWord(offset + 129);
    offset += 193;
    calls.push({
      to,
      value,
      operation,
      data: `0x${reader.slice(offset, length)}`,
    });
    offset += length;
  }
  return calls;
}

function argument(args: readonly VaultArgument[], name: string): VaultAbiValue {
  const arg = args.find((entry) => entry.name === name);
  if (!arg) throw new Error("Missing call argument");
  return arg.value;
}
function textArg(args: readonly VaultArgument[], name: string): string {
  const value = argument(args, name);
  if (typeof value !== "string") throw new Error("Invalid text argument");
  return value;
}
function numberArg(args: readonly VaultArgument[], name: string): bigint {
  const value = argument(args, name);
  if (typeof value !== "bigint") throw new Error("Invalid integer argument");
  return value;
}
function arrayArg(
  args: readonly VaultArgument[],
  name: string,
): readonly VaultAbiValue[] {
  const value = argument(args, name);
  if (typeof value === "string" || typeof value === "bigint")
    throw new Error("Invalid array argument");
  return value;
}

function innerCalls(
  method: string,
  args: readonly VaultArgument[],
): VaultCall[] {
  if (method === "multiSend")
    return decodeVaultMultiSend(textArg(args, "transactions"));
  if (["scheduleBatch", "executeBatch"].includes(method)) {
    const targets = arrayArg(args, "targets"),
      values = arrayArg(args, "values"),
      payloads = arrayArg(args, "payloads");
    if (targets.length !== values.length || targets.length !== payloads.length)
      throw new Error("Unequal batch arrays");
    return targets.map((to, i) => {
      const value = values[i],
        data = payloads[i];
      if (
        typeof to !== "string" ||
        typeof value !== "bigint" ||
        typeof data !== "string"
      )
        throw new Error("Invalid batch entry");
      return { to, value, data, operation: 0n };
    });
  }
  if (["schedule", "execute"].includes(method))
    return [
      {
        to: textArg(args, "target"),
        value: numberArg(args, "value"),
        data: textArg(args, method === "execute" ? "payload" : "data"),
        operation: 0n,
      },
    ];
  if (method === "simulateAndRevert")
    return [
      {
        to: textArg(args, "targetContract"),
        value: 0n,
        data: textArg(args, "calldataPayload"),
        operation: 1n,
      },
    ];
  if (
    [
      "execTransaction",
      "execTransactionFromModule",
      "execTransactionFromModuleReturnData",
    ].includes(method)
  )
    return [
      {
        to: textArg(args, "to"),
        value: numberArg(args, "value"),
        data: textArg(args, "data"),
        operation: numberArg(args, "operation"),
      },
    ];
  return [];
}

export function vaultRoleLabel(value: string): string | undefined {
  return Object.entries(VAULT_ROLES).find(
    ([, hash]) => hash === value.toLowerCase(),
  )?.[0];
}

/** Decode a call and one level of enclosed calls. Deeper payloads remain visible. */
export function decodeVaultCall(
  call: VaultCall,
  chainId: bigint,
  config: QuantaVaultConfig = QUANTA_VAULT_CONFIG,
  depth = 0,
): DecodedVaultCall {
  const warnings: VaultCallWarning[] = [];
  // The selector alone cannot distinguish MultiSend from MultiSendCallOnly.
  const callOnly =
    depth === 0 &&
    call.data.slice(0, 10).toLowerCase() === "0x8d80ff0a" &&
    config.multiSendCallOnly[chainId.toString()]?.some(
      (to) => to.toLowerCase() === call.to.toLowerCase(),
    );
  if (call.operation === 1n && !callOnly) warnings.push("delegateCall");
  if (call.operation !== 0n && call.operation !== 1n)
    warnings.push("invalidCalldata");
  const base = { ...call, args: [], children: [], warnings };
  if (call.data === "0x") return { ...base, status: "empty" };
  const definition = VAULT_SELECTORS.find(
    (entry) => entry.selector === call.data.slice(0, 10).toLowerCase(),
  );
  if (!definition)
    return {
      ...base,
      status: "unknown",
      warnings: [...warnings, "unknownCalldata"],
    };
  try {
    const values = decodeVaultAbi(
      definition.inputs.map((input) => input.type),
      `0x${call.data.slice(10)}`,
    );
    const args = definition.inputs.map((input, index): VaultArgument => {
      const value = values[index];
      if (value === undefined) throw new Error("Missing decoded argument");
      return { ...input, value };
    });
    const method = definition.name;
    if (SECURITY_METHODS.has(method)) warnings.push("securityChange");
    if (method === "simulateAndRevert") warnings.push("delegateCall");
    if (method === "approveHash" || method === "signMessage")
      warnings.push("opaqueApproval");
    if (
      ["grantRole", "revokeRole", "renounceRole"].includes(method) &&
      textArg(
        args,
        method === "renounceRole" ? "callerConfirmation" : "account",
      ).toLowerCase() === QRL_ZERO_ADDRESS.toLowerCase()
    )
      warnings.push("openRole");
    const calls = innerCalls(method, args);
    if (depth >= 1 && calls.length) warnings.push("depthLimit");
    // Even at the depth boundary every batch operation is checked.
    if (depth >= 1 && calls.some((child) => child.operation === 1n))
      warnings.push("delegateCall");
    return {
      ...call,
      status: "decoded",
      method,
      args,
      warnings: [...new Set(warnings)],
      children:
        depth < 1
          ? calls.map((child) =>
              decodeVaultCall(child, chainId, config, depth + 1),
            )
          : [],
    };
  } catch {
    return {
      ...base,
      status: "invalid",
      warnings: [...warnings, "invalidCalldata"],
    };
  }
}
