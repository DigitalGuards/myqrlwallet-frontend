import { parseExternalHttpUrl } from "@/utils/nativeApp";

import type { DAppInfo } from "./types";

const MAX_DAPP_NAME_LENGTH = 128;
const MAX_DAPP_ICON_LENGTH = 64 * 1024;
const MAX_CHAIN_ID_LENGTH = 66;
const DATA_IMAGE_PATTERN =
  /^data:image\/(?:png|jpeg|gif|webp);base64,([A-Za-z0-9+/]+={0,2})$/;
const UNSAFE_DAPP_NAME_PATTERN =
  /[\u061c\u180e\u200b-\u200f\u2028-\u202e\u2060\u2066-\u2069\ufeff]/u;

function hasUnsafeNameCharacters(value: string): boolean {
  if (UNSAFE_DAPP_NAME_PATTERN.test(value)) return true;
  for (const character of value) {
    const codePoint = character.codePointAt(0) ?? 0;
    if (codePoint <= 0x1f || (codePoint >= 0x7f && codePoint <= 0x9f)) {
      return true;
    }
  }
  return false;
}

/** Internal placeholder persisted only until authenticated metadata arrives. */
export const PENDING_DAPP_INFO: Readonly<DAppInfo> = Object.freeze({
  name: "Connecting...",
  url: "",
  chainId: "0x0",
});

function parseIcon(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || value.length === 0 || value.length > MAX_DAPP_ICON_LENGTH) {
    throw new Error("dApp icon is invalid or too large");
  }

  const externalUrl = parseExternalHttpUrl(value);
  if (externalUrl !== null) return externalUrl;

  const match = DATA_IMAGE_PATTERN.exec(value);
  const payload = match?.[1];
  if (!payload || payload.length % 4 !== 0) {
    throw new Error("dApp icon must be a safe image URL or bounded raster data URI");
  }
  return value;
}

function parseChainId(value: unknown): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > MAX_CHAIN_ID_LENGTH ||
    !/^0x[0-9a-fA-F]+$/.test(value)
  ) {
    throw new Error("dApp chain id must be a bounded 0x quantity");
  }
  return `0x${BigInt(value).toString(16)}`;
}

/** Validate and canonicalize authenticated ORIGINATOR_INFO metadata. */
export function parseDAppInfo(value: unknown): DAppInfo {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("ORIGINATOR_INFO must contain a metadata object");
  }
  const record = value as Record<string, unknown>;
  const name = record["name"];
  const url = record["url"];
  if (
    typeof name !== "string" ||
    name.length === 0 ||
    name.length > MAX_DAPP_NAME_LENGTH ||
    name.trim() !== name ||
    hasUnsafeNameCharacters(name)
  ) {
    throw new Error("dApp name is invalid or too large");
  }
  if (typeof url !== "string") throw new Error("dApp URL is missing");
  const safeUrl = parseExternalHttpUrl(url);
  if (safeUrl === null) throw new Error("dApp URL is unsafe or invalid");

  const icon = parseIcon(record["icon"]);
  const redirectValue = record["redirectUrl"];
  let redirectUrl: string | undefined;
  if (redirectValue !== undefined) {
    if (typeof redirectValue !== "string") {
      throw new Error("dApp redirect URL is invalid");
    }
    redirectUrl = parseExternalHttpUrl(redirectValue) ?? undefined;
    if (!redirectUrl) throw new Error("dApp redirect URL is unsafe or invalid");
  }

  return Object.freeze({
    name,
    url: safeUrl,
    chainId: parseChainId(record["chainId"]),
    ...(icon === undefined ? {} : { icon }),
    ...(redirectUrl === undefined ? {} : { redirectUrl }),
  });
}

export function dappInfoEquals(left: DAppInfo, right: DAppInfo): boolean {
  return (
    left.name === right.name &&
    left.url === right.url &&
    left.chainId === right.chainId &&
    left.icon === right.icon &&
    left.redirectUrl === right.redirectUrl
  );
}

export function isPendingDAppInfo(value: DAppInfo): boolean {
  return (
    value.name === PENDING_DAPP_INFO.name &&
    value.url === PENDING_DAPP_INFO.url &&
    value.chainId === PENDING_DAPP_INFO.chainId &&
    value.icon === undefined &&
    value.redirectUrl === undefined
  );
}
