/**
 * Session store - localStorage persistence for dApp sessions (v4).
 *
 * v4 is restricted to capability-bound PQP3 handshakes and checkpoints AEAD
 * counters after every seal/open. Earlier records are dropped so neither old
 * sparse counters nor pre-PQP3 keys can be resumed after this upgrade.
 */

import { type DAppInfo, type DAppSession, SessionStatus } from "./types";
import {
  isPersistedSessionEncodingValid,
  type PersistedSession,
} from "./KeyExchange";
import { fromBase64 } from "./PQCrypto";
import { cidToString } from "./qrUri";
import {
  getWalletEpoch,
  INITIAL_WALLET_EPOCH,
  isWalletEpochCurrent,
  type WalletEpoch,
} from "@/utils/walletEpoch";
import {
  isPendingDAppInfo,
  parseDAppInfo as parseValidatedDAppInfo,
} from "./dappMetadata";

const STORAGE_KEY = "qrlconnect:sessions";
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const CID_STRING_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parsePersistedKeyExchange(value: unknown): PersistedSession | null {
  if (!isRecord(value)) return null;
  const {
    protocolVersion,
    cid,
    kAeadRaw,
    htx,
    sendDir,
    recvDir,
    sendSeq,
    recvSeq,
  } = value;
  if (
    protocolVersion !== 3 ||
    typeof cid !== "string" ||
    typeof kAeadRaw !== "string" ||
    typeof htx !== "string" ||
    typeof sendDir !== "string" ||
    typeof recvDir !== "string" ||
    !Number.isSafeInteger(sendSeq) ||
    (sendSeq as number) < 0 ||
    (sendSeq as number) >= Number.MAX_SAFE_INTEGER ||
    !Number.isSafeInteger(recvSeq) ||
    (recvSeq as number) < 0 ||
    (recvSeq as number) >= Number.MAX_SAFE_INTEGER
  ) {
    return null;
  }
  const parsed: PersistedSession = {
    protocolVersion,
    cid,
    kAeadRaw,
    htx,
    sendDir,
    recvDir,
    sendSeq: sendSeq as number,
    recvSeq: recvSeq as number,
  };
  return isPersistedSessionEncodingValid(parsed) ? parsed : null;
}

function parseDAppInfo(value: unknown): DAppInfo | null {
  try {
    return parseValidatedDAppInfo(value);
  } catch {
    if (!isRecord(value)) return null;
    const pending: DAppInfo = {
      name: typeof value["name"] === "string" ? value["name"] : "",
      url: typeof value["url"] === "string" ? value["url"] : "",
      chainId: typeof value["chainId"] === "string" ? value["chainId"] : "",
      ...(typeof value["icon"] === "string" ? { icon: value["icon"] } : {}),
      ...(typeof value["redirectUrl"] === "string"
        ? { redirectUrl: value["redirectUrl"] }
        : {}),
    };
    return isPendingDAppInfo(pending) ? pending : null;
  }
}

function normalizeDAppInfoForState(
  info: DAppInfo,
  received: boolean,
): DAppInfo | null {
  if (!received) return isPendingDAppInfo(info) ? info : null;
  try {
    return parseValidatedDAppInfo(info);
  } catch {
    return null;
  }
}

function parseOriginatorState(value: Record<string, unknown>, info: DAppInfo): boolean | null {
  if (typeof value["originatorInfoReceived"] !== "boolean") {
    return null;
  }
  const received = value["originatorInfoReceived"];
  return normalizeDAppInfoForState(info, received) ? received : null;
}

function sessionIdMatchesKeyExchange(id: unknown, keyExchange: PersistedSession): id is string {
  if (typeof id !== "string" || !CID_STRING_PATTERN.test(id)) return false;
  try {
    return cidToString(fromBase64(keyExchange.cid)) === id;
  } catch {
    return false;
  }
}

function isSafeRelayUrl(value: unknown): boolean {
  if (value === undefined) return true;
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > 2048 ||
    value.trim() !== value
  ) {
    return false;
  }
  try {
    const parsed = new URL(value);
    if (
      parsed.username !== "" ||
      parsed.password !== "" ||
      parsed.hostname === "" ||
      parsed.search !== "" ||
      parsed.hash !== ""
    ) {
      return false;
    }
    if (parsed.protocol === "https:") return true;
    return (
      parsed.protocol === "http:" &&
      (parsed.hostname === "localhost" ||
        parsed.hostname.endsWith(".localhost") ||
        parsed.hostname === "127.0.0.1" ||
        parsed.hostname === "[::1]")
    );
  } catch {
    return false;
  }
}

function areSessionTimestampsValid(
  createdAt: unknown,
  lastActivity: unknown,
  now = Date.now(),
): createdAt is number {
  return (
    Number.isSafeInteger(createdAt) &&
    Number.isSafeInteger(lastActivity) &&
    (createdAt as number) >= 0 &&
    (lastActivity as number) >= (createdAt as number) &&
    (lastActivity as number) <= now
  );
}

function parseSession(
  value: unknown,
  expectedEpoch: WalletEpoch,
): DAppSession | null {
  if (!isRecord(value) || value["version"] !== 4) return null;
  const dappInfo = parseDAppInfo(value["dappInfo"]);
  const keyExchange = parsePersistedKeyExchange(value["keyExchange"]);
  const originatorInfoReceived = dappInfo
    ? parseOriginatorState(value, dappInfo)
    : null;
  const validStatus = Object.values(SessionStatus).includes(
    value["status"] as SessionStatus,
  );
  if (
    !dappInfo ||
    !keyExchange ||
    originatorInfoReceived === null ||
    !sessionIdMatchesKeyExchange(value["id"], keyExchange) ||
    typeof value["accountAuthorized"] !== "boolean" ||
    typeof value["connectedAccount"] !== "string" ||
    (value["accountAuthorized"]
      ? !/^Q[0-9a-fA-F]{40}$/.test(value["connectedAccount"])
      : value["connectedAccount"] !== "") ||
    !isSafeRelayUrl(value["relayUrl"]) ||
    !validStatus ||
    !areSessionTimestampsValid(value["createdAt"], value["lastActivity"])
  ) {
    return null;
  }
  const storedEpoch = value["walletEpoch"];
  if (
    storedEpoch !== expectedEpoch &&
    !(storedEpoch === undefined && expectedEpoch === INITIAL_WALLET_EPOCH)
  ) {
    return null;
  }
  return {
    version: 4,
    id: value["id"],
    dappInfo,
    originatorInfoReceived,
    accountAuthorized: value["accountAuthorized"],
    connectedAccount: value["connectedAccount"],
    keyExchange,
    ...(typeof value["relayUrl"] === "string"
      ? { relayUrl: value["relayUrl"] }
      : {}),
    status: value["status"] as SessionStatus,
    createdAt: value["createdAt"],
    lastActivity: value["lastActivity"] as number,
    walletEpoch: expectedEpoch,
  };
}

function readSessions(expectedEpoch: WalletEpoch = getWalletEpoch()): {
  sessions: DAppSession[];
  dropped: number;
} {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return { sessions: [], dropped: 0 };
  const parsed: unknown = JSON.parse(raw);
  if (!Array.isArray(parsed)) {
    throw new Error("Invalid QRL Connect session store");
  }
  const now = Date.now();
  const sessions: DAppSession[] = [];
  let dropped = 0;
  for (const value of parsed) {
    const session = parseSession(value, expectedEpoch);
    if (!session || now - session.createdAt >= SESSION_TTL_MS) {
      dropped++;
      continue;
    }
    sessions.push(session);
  }
  return { sessions, dropped };
}

function writeSessions(
  sessions: DAppSession[],
  expectedEpoch: WalletEpoch,
): void {
  if (!isWalletEpochCurrent(expectedEpoch)) {
    throw new Error("Wallet identity changed before QRL Connect checkpoint");
  }
  const serialized = JSON.stringify(
    sessions.map((session) => ({ ...session, walletEpoch: expectedEpoch })),
  );
  localStorage.setItem(STORAGE_KEY, serialized);
  if (isWalletEpochCurrent(expectedEpoch)) return;

  // Remove only the exact checkpoint written by the stale tab. A newly paired
  // wallet at the newer epoch must not be erased by this cleanup.
  if (localStorage.getItem(STORAGE_KEY) === serialized) {
    localStorage.removeItem(STORAGE_KEY);
  }
  throw new Error("Wallet identity changed during QRL Connect checkpoint");
}

export class SessionStore {
  /**
   * Remove only a store that contains no valid record for the current wallet
   * generation. The raw-value comparison prevents a delayed epoch listener
   * from deleting a fresh session written by another tab after this read.
   */
  static clearStale(expectedEpoch: WalletEpoch = getWalletEpoch()): void {
    if (!isWalletEpochCurrent(expectedEpoch)) return;
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === null) return;

    let containsCurrentSession = false;
    try {
      const parsed: unknown = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        containsCurrentSession = parsed.some(
          (value) => parseSession(value, expectedEpoch) !== null,
        );
      }
    } catch {
      // A malformed store has no restorable current-epoch session.
    }
    if (containsCurrentSession || !isWalletEpochCurrent(expectedEpoch)) return;
    if (localStorage.getItem(STORAGE_KEY) === raw) {
      localStorage.removeItem(STORAGE_KEY);
    }
  }

  /**
   * Delete legacy, expired, or malformed entries after the service has
   * acquired origin-wide ownership. getAll() stays read-only so a non-owner
   * tab cannot race an active counter checkpoint.
   */
  static prune(expectedEpoch: WalletEpoch = getWalletEpoch()): void {
    const rawBefore = localStorage.getItem(STORAGE_KEY);
    try {
      if (!isWalletEpochCurrent(expectedEpoch)) {
        throw new Error(
          "Wallet identity changed before QRL Connect maintenance",
        );
      }
      const { sessions, dropped } = readSessions(expectedEpoch);
      if (dropped === 0) return;
      if (sessions.length === 0) {
        if (
          isWalletEpochCurrent(expectedEpoch) &&
          localStorage.getItem(STORAGE_KEY) === rawBefore
        ) {
          localStorage.removeItem(STORAGE_KEY);
        }
      } else {
        writeSessions(sessions, expectedEpoch);
      }
    } catch (err) {
      // Corrupt or unrewritable storage must never preserve a raw session key
      // whose counters cannot be validated. Best effort is to invalidate the
      // whole QRL Connect store, then surface the maintenance failure.
      try {
        if (
          isWalletEpochCurrent(expectedEpoch) &&
          localStorage.getItem(STORAGE_KEY) === rawBefore
        ) {
          localStorage.removeItem(STORAGE_KEY);
        }
      } catch {
        // The service still refuses to restore anything getAll() cannot parse.
      }
      throw err;
    }
  }

  static save(
    session: DAppSession,
    expectedEpoch: WalletEpoch = getWalletEpoch(),
  ): void {
    const normalizedDAppInfo =
      typeof session.originatorInfoReceived === "boolean"
        ? normalizeDAppInfoForState(
            session.dappInfo,
            session.originatorInfoReceived,
          )
        : null;
    if (
      typeof session.accountAuthorized !== "boolean" ||
      typeof session.originatorInfoReceived !== "boolean" ||
      !normalizedDAppInfo ||
      !sessionIdMatchesKeyExchange(session.id, session.keyExchange) ||
      !isSafeRelayUrl(session.relayUrl) ||
      (session.accountAuthorized
        ? !/^Q[0-9a-fA-F]{40}$/.test(session.connectedAccount)
        : session.connectedAccount !== "")
    ) {
      throw new Error("QRL Connect session has an invalid connected account");
    }
    if (
      !isPersistedSessionEncodingValid(session.keyExchange) ||
      !Object.values(SessionStatus).includes(session.status) ||
      !areSessionTimestampsValid(session.createdAt, session.lastActivity)
    ) {
      throw new Error("QRL Connect session has invalid persisted state");
    }
    // Use the strict reader here instead of getAll(): getAll() intentionally
    // fails closed to [] for the reconnect UI, but swallowing a storage read
    // error during a checkpoint could overwrite unrelated sessions.
    const { sessions } = readSessions(expectedEpoch);
    const boundSession = {
      ...session,
      dappInfo: normalizedDAppInfo,
      walletEpoch: expectedEpoch,
    };
    const index = sessions.findIndex((s) => s.id === session.id);
    if (index >= 0) {
      sessions[index] = boundSession;
    } else {
      sessions.push(boundSession);
    }
    writeSessions(sessions, expectedEpoch);
  }

  static getAll(): DAppSession[] {
    try {
      // Reads stay side-effect free. In particular, a non-owner wallet tab
      // must not race the active tab by rewriting the shared session array
      // while merely filtering legacy/expired records for display.
      const { sessions } = readSessions();
      return sessions;
    } catch {
      return [];
    }
  }

  static get(channelId: string): DAppSession | null {
    return SessionStore.getAll().find((s) => s.id === channelId) || null;
  }

  static remove(
    channelId: string,
    expectedEpoch: WalletEpoch = getWalletEpoch(),
  ): void {
    if (!isWalletEpochCurrent(expectedEpoch)) return;
    try {
      const sessions = readSessions(expectedEpoch).sessions.filter(
        (s) => s.id !== channelId,
      );
      writeSessions(sessions, expectedEpoch);
    } catch (err) {
      // A stale counter record is more dangerous than losing other reconnect
      // records. removeItem() still succeeds for the common quota-exhaustion
      // case where setItem() cannot rewrite the array, so invalidate the whole
      // QRL Connect store as a fail-closed fallback and surface the error.
      try {
        if (isWalletEpochCurrent(expectedEpoch))
          localStorage.removeItem(STORAGE_KEY);
      } catch {
        // The caller will also tombstone the relay channel and drop memory.
      }
      throw err;
    }
  }

  static updateStatus(
    channelId: string,
    status: SessionStatus,
    expectedEpoch: WalletEpoch = getWalletEpoch(),
  ): void {
    const session = SessionStore.get(channelId);
    if (session) {
      session.status = status;
      session.lastActivity = Date.now();
      SessionStore.save(session, expectedEpoch);
    }
  }

  static clearAll(): void {
    localStorage.removeItem(STORAGE_KEY);
  }
}
