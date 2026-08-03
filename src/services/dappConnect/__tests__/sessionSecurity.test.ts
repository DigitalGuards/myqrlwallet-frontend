import { afterAll, beforeEach, describe, expect, it } from "@jest/globals";
import {
  KeyExchange,
  PROTOCOL_VERSION,
  type AckMessage,
  type Session,
} from "../KeyExchange";
import {
  DIR_DAPP_TX,
  DIR_WALLET_TX,
  deriveAeadKey,
  fromBase64,
  importRawAeadKey,
  kemDecaps,
  kemKeygen,
  seal,
  toBase64,
  transcriptHash,
  zeroize,
} from "../PQCrypto";
import { KeyExchangeMessageType } from "../types";
import { SessionStore } from "../SessionStore";
import { type DAppSession, SessionStatus } from "../types";
import { advanceWalletEpoch, getWalletEpoch } from "@/utils/walletEpoch";
import { cidToString } from "../qrUri";

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();

  get length(): number {
    return this.values.size;
  }

  clear(): void {
    this.values.clear();
  }

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  key(index: number): string | null {
    return Array.from(this.values.keys())[index] ?? null;
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
}

const originalLocalStorage = Object.getOwnPropertyDescriptor(
  globalThis,
  "localStorage",
);

async function makeExchanges(): Promise<{
  wallet: KeyExchange;
  dapp: KeyExchange;
}> {
  const rawKey = globalThis.crypto.getRandomValues(new Uint8Array(32));
  const key = await importRawAeadKey(rawKey);
  const cid = globalThis.crypto.getRandomValues(new Uint8Array(16));
  const htx = globalThis.crypto.getRandomValues(new Uint8Array(32));
  const walletSession: Session = {
    cid,
    key,
    htx,
    sendDir: DIR_WALLET_TX,
    recvDir: DIR_DAPP_TX,
    sendSeq: 1,
    recvSeq: 1,
  };
  const dappSession: Session = {
    cid,
    key,
    htx,
    sendDir: DIR_DAPP_TX,
    recvDir: DIR_WALLET_TX,
    sendSeq: 1,
    recvSeq: 1,
  };
  return {
    wallet: new KeyExchange(walletSession),
    dapp: new KeyExchange(dappSession),
  };
}

async function makeStoredSession(): Promise<DAppSession> {
  const { wallet } = await makeExchanges();
  const keyExchange = await wallet.exportPersisted();
  if (!keyExchange) throw new Error("Expected a persisted key exchange");
  return {
    version: 4,
    id: cidToString(fromBase64(keyExchange.cid)),
    dappInfo: {
      name: "Security test dApp",
      url: "https://dapp.example/",
      chainId: "0x1",
    },
    originatorInfoReceived: true,
    accountAuthorized: true,
    connectedAccount: "Q0000000000000000000000000000000000000000",
    keyExchange,
    relayUrl: "https://relay.example",
    status: SessionStatus.CONNECTED,
    createdAt: Date.now(),
    lastActivity: Date.now(),
  };
}

beforeEach(() => {
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: new MemoryStorage(),
  });
});

afterAll(() => {
  if (originalLocalStorage) {
    Object.defineProperty(globalThis, "localStorage", originalLocalStorage);
  } else {
    Reflect.deleteProperty(globalThis, "localStorage");
  }
});

describe("wallet KeyExchange counter discipline", () => {
  it("retires provisional keys when an ACK is not exact protocol v3", async () => {
    const wallet = new KeyExchange();
    const cid = globalThis.crypto.getRandomValues(new Uint8Array(16));
    const cap = globalThis.crypto.getRandomValues(new Uint8Array(32));
    const { pk, sk } = kemKeygen();
    let ss: Uint8Array | null = null;
    try {
      const synack = await wallet.receiveQR(cid, pk, cap);
      expect(synack.v).toBe(PROTOCOL_VERSION);

      const ct = fromBase64(synack.ct);
      ss = kemDecaps(sk, ct);
      const htx = await transcriptHash(cid, pk, ct, cap);
      const key = await deriveAeadKey(ss, htx, cap);
      const c1 = await seal(
        key,
        DIR_DAPP_TX,
        0,
        htx,
        new TextEncoder().encode("hello/dapp/v1"),
      );
      const ack: AckMessage = {
        type: KeyExchangeMessageType.ACK,
        c1: toBase64(c1),
        v: 2,
      };

      await expect(wallet.onAck(ack)).rejects.toThrow(
        "ACK must use protocol v3",
      );
      expect(wallet.areKeysExchanged()).toBe(false);
      expect(wallet.getSession()).toBeNull();

      // The old provisional key cannot be revived by a later valid-looking ACK.
      await expect(wallet.onAck({ ...ack, v: PROTOCOL_VERSION })).resolves.toBeUndefined();
      expect(wallet.areKeysExchanged()).toBe(false);
    } finally {
      zeroize(sk);
      if (ss) zeroize(ss);
    }
  });

  it("rejects an ACK derived without the QR bearer capability", async () => {
    const wallet = new KeyExchange();
    const cid = globalThis.crypto.getRandomValues(new Uint8Array(16));
    const cap = globalThis.crypto.getRandomValues(new Uint8Array(32));
    const wrongCap = cap.slice();
    wrongCap[0] = (wrongCap[0] as number) ^ 0xff;
    const { pk, sk } = kemKeygen();
    let ss: Uint8Array | null = null;
    try {
      const synack = await wallet.receiveQR(cid, pk, cap);
      const ct = fromBase64(synack.ct);
      ss = kemDecaps(sk, ct);
      const wrongHtx = await transcriptHash(cid, pk, ct, wrongCap);
      const wrongKey = await deriveAeadKey(ss, wrongHtx, wrongCap);
      const forgedC1 = await seal(
        wrongKey,
        DIR_DAPP_TX,
        0,
        wrongHtx,
        new TextEncoder().encode("hello/dapp/v1"),
      );

      await expect(
        wallet.onAck({
          type: KeyExchangeMessageType.ACK,
          c1: toBase64(forgedC1),
          v: PROTOCOL_VERSION,
        }),
      ).rejects.toThrow("dApp hello AEAD tag failed");
      expect(wallet.areKeysExchanged()).toBe(false);
      expect(wallet.getSession()).toBeNull();
    } finally {
      zeroize(sk);
      if (ss) zeroize(ss);
      zeroize(wrongCap);
    }
  });

  it("lets only the newest overlapping QR scan commit provisional state", async () => {
    const wallet = new KeyExchange();
    const firstCid = globalThis.crypto.getRandomValues(new Uint8Array(16));
    const secondCid = globalThis.crypto.getRandomValues(new Uint8Array(16));
    const firstCap = globalThis.crypto.getRandomValues(new Uint8Array(32));
    const secondCap = globalThis.crypto.getRandomValues(new Uint8Array(32));
    const firstKeys = kemKeygen();
    const secondKeys = kemKeygen();
    try {
      const first = wallet.receiveQR(firstCid, firstKeys.pk, firstCap);
      const second = wallet.receiveQR(secondCid, secondKeys.pk, secondCap);
      const results = await Promise.allSettled([first, second]);

      expect(results[0]).toMatchObject({
        status: "rejected",
        reason: expect.objectContaining({
          message: "KeyExchange: handshake generation changed",
        }),
      });
      expect(results[1]).toMatchObject({
        status: "fulfilled",
        value: expect.objectContaining({ v: PROTOCOL_VERSION }),
      });
      expect(Array.from(wallet.getSession()?.cid ?? [])).toEqual(
        Array.from(secondCid),
      );
    } finally {
      zeroize(firstKeys.sk);
      zeroize(secondKeys.sk);
      zeroize(firstCap);
      zeroize(secondCap);
    }
  });

  it("assigns unique contiguous nonces to concurrent encryptions", async () => {
    const { wallet, dapp } = await makeExchanges();
    const plaintexts = ["one", "two", "three", "four", "five"];

    const ciphertexts = await Promise.all(
      plaintexts.map((plaintext) => wallet.encryptMessage(plaintext)),
    );

    for (let index = 0; index < plaintexts.length; index++) {
      expect(await dapp.decryptMessage(ciphertexts[index] as string)).toBe(
        plaintexts[index],
      );
    }
    expect(wallet.getSession()?.sendSeq).toBe(1 + plaintexts.length);
  });

  it("exports the advanced receive counter so a restored session rejects replay", async () => {
    const { wallet, dapp } = await makeExchanges();
    const ciphertext = await dapp.encryptMessage("delivered once");
    await expect(wallet.decryptMessage(ciphertext)).resolves.toBe(
      "delivered once",
    );

    const checkpoint = await wallet.exportPersisted();
    if (!checkpoint) throw new Error("Expected a persisted key exchange");
    const restored = new KeyExchange(
      await KeyExchange.sessionFromPersisted(checkpoint),
    );

    await expect(restored.decryptMessage(ciphertext)).rejects.toThrow();
  });

  it("fails closed before an AEAD counter can leave the safe-integer range", async () => {
    const { wallet } = await makeExchanges();
    const session = wallet.getSession();
    if (!session) throw new Error("Expected established session");
    session.sendSeq = Number.MAX_SAFE_INTEGER;
    session.recvSeq = Number.MAX_SAFE_INTEGER;

    await expect(wallet.encryptMessage("must not seal")).rejects.toThrow(
      "counter exhausted",
    );
    await expect(wallet.decryptMessage("AA==")).rejects.toThrow(
      "counter exhausted",
    );
  });
});

describe("SessionStore v4 migration boundary", () => {
  it("drops v3 records instead of restoring pre-PQP3 key material", async () => {
    const session = await makeStoredSession();
    localStorage.setItem(
      "qrlconnect:sessions",
      JSON.stringify([{ ...session, version: 3 }]),
    );

    expect(SessionStore.getAll()).toEqual([]);
    // Reads do not rewrite the shared array; the service calls prune() only
    // after acquiring origin-wide ownership.
    expect(localStorage.getItem("qrlconnect:sessions")).toContain(
      '"version":3',
    );
    SessionStore.prune();
    expect(localStorage.getItem("qrlconnect:sessions")).toBeNull();
  });

  it("round-trips a valid v4 record and rejects malformed counters", async () => {
    const session = await makeStoredSession();
    SessionStore.save(session);
    expect(SessionStore.get(session.id)).toEqual({
      ...session,
      walletEpoch: getWalletEpoch(),
    });

    localStorage.setItem(
      "qrlconnect:sessions",
      JSON.stringify([
        { ...session, keyExchange: { ...session.keyExchange, sendSeq: -1 } },
      ]),
    );
    expect(SessionStore.getAll()).toEqual([]);

    localStorage.setItem(
      "qrlconnect:sessions",
      JSON.stringify([
        {
          ...session,
          keyExchange: {
            ...session.keyExchange,
            recvSeq: Number.MAX_SAFE_INTEGER,
          },
        },
      ]),
    );
    expect(SessionStore.getAll()).toEqual([]);
  });

  it("rejects oversized, non-canonical, and wrong-size persisted KEX fields", async () => {
    const session = await makeStoredSession();
    const malformed = [
      { ...session.keyExchange, kAeadRaw: "A".repeat(10000) },
      { ...session.keyExchange, cid: toBase64(new Uint8Array(15)) },
      { ...session.keyExchange, htx: toBase64(new Uint8Array(31)) },
      { ...session.keyExchange, sendDir: toBase64(new Uint8Array([0, 0, 0, 3])) },
      { ...session.keyExchange, recvDir: "AAAAAAAA" },
      { ...session.keyExchange, protocolVersion: 2 },
    ];

    for (const keyExchange of malformed) {
      localStorage.setItem(
        "qrlconnect:sessions",
        JSON.stringify([{ ...session, keyExchange }]),
      );
      expect(SessionStore.getAll()).toEqual([]);
    }
  });

  it("binds the UUID session id to the persisted KEX cid and safe relay", async () => {
    const session = await makeStoredSession();
    for (const malformed of [
      { ...session, id: "not-a-channel" },
      { ...session, id: "00000000-0000-0000-0000-000000000000" },
      { ...session, relayUrl: "javascript:alert(1)" },
      { ...session, relayUrl: "https://user:pass@relay.example" },
      { ...session, relayUrl: "http://relay.example" },
      { ...session, relayUrl: "https://relay.example?cap=secret" },
      { ...session, relayUrl: "https://relay.example/#fragment" },
      { ...session, relayUrl: "https://relay.example/" + "x".repeat(2048) },
    ]) {
      localStorage.setItem("qrlconnect:sessions", JSON.stringify([malformed]));
      expect(SessionStore.getAll()).toEqual([]);
      expect(() => SessionStore.save(malformed)).toThrow();
    }

    expect(() =>
      SessionStore.save({ ...session, relayUrl: "http://localhost:8787" }),
    ).not.toThrow();
    expect(() =>
      SessionStore.save({ ...session, relayUrl: "http://relay.localhost:8787" }),
    ).not.toThrow();
  });

  it("rejects negative, future, and out-of-order session timestamps", async () => {
    const session = await makeStoredSession();
    const now = Date.now();
    const malformed = [
      { ...session, createdAt: -1, lastActivity: now },
      { ...session, createdAt: now, lastActivity: now - 1 },
      { ...session, createdAt: now, lastActivity: now + 60_000 },
      { ...session, createdAt: now + 60_000, lastActivity: now + 60_000 },
      { ...session, createdAt: now + 0.5, lastActivity: now + 0.5 },
    ];

    for (const poisoned of malformed) {
      localStorage.setItem("qrlconnect:sessions", JSON.stringify([poisoned]));
      expect(SessionStore.getAll()).toEqual([]);
      expect(() => SessionStore.save(poisoned)).toThrow(
        "invalid persisted state",
      );
    }
  });

  it("round-trips explicit unauthorized and pre-originator session state", async () => {
    const session = await makeStoredSession();
    const pending: DAppSession = {
      ...session,
      dappInfo: { name: "Connecting...", url: "", chainId: "0x0" },
      originatorInfoReceived: false,
      accountAuthorized: false,
      connectedAccount: "",
    };
    SessionStore.save(pending);
    expect(SessionStore.get(pending.id)).toMatchObject({
      originatorInfoReceived: false,
      accountAuthorized: false,
      connectedAccount: "",
    });

    expect(() =>
      SessionStore.save({ ...pending, connectedAccount: session.connectedAccount }),
    ).toThrow("invalid connected account");
  });

  it("propagates checkpoint write failures to the caller", async () => {
    const session = await makeStoredSession();
    const storage = localStorage;
    Object.defineProperty(storage, "setItem", {
      configurable: true,
      value: (): never => {
        throw new Error("quota denied");
      },
    });

    expect(() => SessionStore.save(session)).toThrow("quota denied");
  });

  it("invalidates all reconnect records if a targeted removal cannot be rewritten", async () => {
    const session = await makeStoredSession();
    SessionStore.save(session);
    const storage = localStorage;
    Object.defineProperty(storage, "setItem", {
      configurable: true,
      value: (): never => {
        throw new Error("quota denied");
      },
    });

    expect(() => SessionStore.remove(session.id)).toThrow("quota denied");
    expect(localStorage.getItem("qrlconnect:sessions")).toBeNull();
  });

  it("stores the exact exported counter values", async () => {
    const session = await makeStoredSession();
    session.keyExchange.sendSeq = 17;
    session.keyExchange.recvSeq = 23;
    SessionStore.save(session);

    expect(SessionStore.get(session.id)?.keyExchange).toMatchObject({
      sendSeq: 17,
      recvSeq: 23,
    });
  });

  it("does not restore a stale checkpoint written after a wallet epoch change", async () => {
    const session = await makeStoredSession();
    SessionStore.save(session);
    const staleWrite = localStorage.getItem("qrlconnect:sessions");
    expect(staleWrite).not.toBeNull();

    advanceWalletEpoch();
    SessionStore.clearAll();
    localStorage.setItem("qrlconnect:sessions", staleWrite as string);

    expect(SessionStore.getAll()).toEqual([]);
  });

  it("preserves a valid current-epoch session during stale-only cleanup", async () => {
    const epoch = advanceWalletEpoch();
    const session = await makeStoredSession();
    SessionStore.save(session, epoch);

    SessionStore.clearStale(epoch);

    expect(SessionStore.get(session.id)).toMatchObject({
      id: session.id,
      walletEpoch: epoch,
    });
  });

  it.each([
    ["empty", ""],
    ["non-hex", `Q${"zz".repeat(20)}`],
    ["roadmap-length", `Q${"11".repeat(32)}`],
  ])(
    "rejects a restored session with a %s connected account",
    async (_label, account) => {
      const session = await makeStoredSession();
      localStorage.setItem(
        "qrlconnect:sessions",
        JSON.stringify([{ ...session, connectedAccount: account }]),
      );

      expect(SessionStore.getAll()).toEqual([]);
      expect(() =>
        SessionStore.save({ ...session, connectedAccount: account }),
      ).toThrow("invalid connected account");
    },
  );
});
