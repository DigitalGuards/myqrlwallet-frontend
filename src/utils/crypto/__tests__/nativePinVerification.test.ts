import { useEffect } from "react";
import NativeAppBridge from "@/components/NativeAppBridge";
import {
  sendPinVerified,
  subscribeToNativeMessages,
  notifySeedStored,
  type NativeMessage,
} from "@/utils/nativeApp";
import StorageUtil from "@/utils/storage/storage";
import {
  WalletEncryptionUtil,
  DeviceCredentialUnavailableError,
} from "@/utils/crypto/walletEncryption";
import { getDeviceEncryptionKey } from "@/utils/crypto/deviceCredential";
import { deriveCanonicalAddressFromHexSeed } from "@/utils/crypto/seedIdentity";
import { decryptStoredSeedWithPin } from "@/utils/crypto/storedSeed";
import { verifyStoredSeedPinAsync } from "@/utils/crypto/cryptoWorkerClient";
import { walletMutations } from "@/utils/nativeWalletMutation";
import { MLDSA87 } from "@theqrl/wallet.js";

jest.mock("react", () => ({
  useEffect: jest.fn(),
  useCallback: <T>(callback: T) => callback,
  useRef: <T>(current: T) => ({ current }),
}));
jest.mock("react-router", () => ({
  useNavigate: () => jest.fn(),
  useLocation: () => ({ search: "" }),
}));
jest.mock("@/utils/nativeApp", () => ({
  isInNativeApp: () => true,
  subscribeToNativeMessages: jest.fn(),
  sendPinVerified: jest.fn(),
  notifySeedStored: jest.fn(),
  notifyWebAppReady: jest.fn(),
  logToNative: jest.fn(),
}));
jest.mock("@/utils/storage/storage", () => ({
  __esModule: true,
  default: {
    getBlockChain: jest.fn(),
    getActiveAccount: jest.fn(),
    getEncryptedSeed: jest.fn(),
    getAllEncryptedSeeds: jest.fn(),
    migrateEncryptedSeed: jest.fn(),
  },
}));
jest.mock("@/utils/crypto/deviceCredential", () => {
  class DeviceCredentialUnavailableError extends Error {}
  return {
    DeviceCredentialUnavailableError,
    getDeviceEncryptionKey: jest.fn(),
  };
});
jest.mock("@/utils/crypto", () =>
  jest.requireActual("@/utils/crypto/cryptoWorkerClient"),
);
jest.mock("../cryptoWorker?worker", () => jest.fn(), {
  virtual: true,
});
jest.mock("@/utils/crypto/cryptoWorker", () => ({
  CryptoErrorCode: {
    INCORRECT_PIN: "INCORRECT_PIN",
    OUTDATED_FORMAT: "OUTDATED_FORMAT",
    DEVICE_CREDENTIAL_UNAVAILABLE: "DEVICE_CREDENTIAL_UNAVAILABLE",
    UNKNOWN: "UNKNOWN",
  },
}));
jest.mock("@/services/dappConnect/DAppConnectService", () => ({}));
jest.mock("@/router/router", () => ({ ROUTES: {} }));
jest.mock("@/utils/addressBook", () => ({}));
jest.mock("@/config", () => ({
  QRL_PROVIDER: { TEST_NET_V3: {} },
  AVAILABLE_NETWORKS: [{ id: "TEST_NET_V3" }],
  isAvailableNetwork: (network: string) => network === "TEST_NET_V3",
}));
jest.mock("@/stores/store", () => ({ store: {} }));
jest.mock("@/utils/mobileConnect/mobileConnection", () => ({}));
jest.mock("@/services/dappConnect/accountBinding", () => ({}));

const BLOCKCHAIN = "TEST_NET_V3";
const PIN = "123456";
function ephemeralSeed() {
  const wallet = MLDSA87.newWallet();
  try {
    return {
      mnemonic: wallet.getMnemonic(),
      hexSeed: wallet.getHexExtendedSeed(),
    };
  } finally {
    wallet.zeroize();
  }
}
const SEED = ephemeralSeed();
const ADDRESS = deriveCanonicalAddressFromHexSeed(SEED.hexSeed);
const OTHER_ADDRESS = deriveCanonicalAddressFromHexSeed(
  ephemeralSeed().hexSeed,
);
let deviceKey: CryptoKey;
let v5: string;
let v4: string;
let ciphertext: string | null;
let revision: number;
let requestNumber = 0;
let receive: (message: NativeMessage) => void;
let dispose: (() => void) | undefined;

async function bounded<T>(operation: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error("Verification did not settle")),
          2000,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

async function response(): Promise<unknown[]> {
  for (let attempt = 0; attempt < 400; attempt += 1) {
    const calls = jest.mocked(sendPinVerified).mock.calls;
    const call = calls[calls.length - 1];
    if (call) return call;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error("Verification response was not sent");
}

function verify(pin = PIN): string {
  const requestId = (++requestNumber).toString(16).padStart(32, "0");
  receive({ type: "VERIFY_PIN", payload: { requestId, pin } });
  return requestId;
}

async function makeLegacyCiphertext(): Promise<string> {
  const encoder = new TextEncoder();
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const base = await crypto.subtle.importKey(
    "raw",
    encoder.encode(PIN),
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  const key = await crypto.subtle.deriveKey(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations: 600000 },
    base,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt"],
  );
  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    encoder.encode(JSON.stringify(SEED)),
  );
  const hex = (bytes: Uint8Array) => Buffer.from(bytes).toString("hex");
  return JSON.stringify({
    version: "pin_v4",
    salt: hex(salt),
    iv: hex(iv),
    encryptedData: hex(new Uint8Array(encrypted)),
    timestamp: 1,
  });
}

beforeAll(async () => {
  deviceKey = await crypto.subtle.generateKey(
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
  jest.mocked(getDeviceEncryptionKey).mockResolvedValue(deviceKey);
  v5 = await WalletEncryptionUtil.encryptSeedWithPin(
    SEED.mnemonic,
    SEED.hexSeed,
    PIN,
  );
  v4 = await makeLegacyCiphertext();
});

beforeEach(() => {
  jest.clearAllMocks();
  ciphertext = v5;
  revision = 1;
  jest.mocked(getDeviceEncryptionKey).mockResolvedValue(deviceKey);
  jest.mocked(StorageUtil.getBlockChain).mockResolvedValue(BLOCKCHAIN);
  jest.mocked(StorageUtil.getActiveAccount).mockResolvedValue(ADDRESS);
  jest
    .mocked(StorageUtil.getEncryptedSeed)
    .mockImplementation(async () => ciphertext);
  jest.mocked(StorageUtil.getAllEncryptedSeeds).mockImplementation(async () =>
    ciphertext
      ? [
          {
            address: ADDRESS,
            encryptedSeed: ciphertext,
            revision,
            lastAccessed: 1,
          },
        ]
      : [],
  );
  jest
    .mocked(StorageUtil.migrateEncryptedSeed)
    .mockImplementation(async (_network, address, expected, next) => {
      if (ciphertext !== expected) return null;
      ciphertext = next;
      return {
        address,
        encryptedSeed: next,
        revision: ++revision,
        lastAccessed: 1,
      };
    });
  jest
    .mocked(notifySeedStored)
    .mockResolvedValue({ revision: 2, ciphertextHash: "ab".repeat(32) });
  jest.mocked(subscribeToNativeMessages).mockImplementation((listener) => {
    receive = listener;
    return () => undefined;
  });
  jest.mocked(useEffect).mockImplementation((effect) => {
    dispose = effect() as (() => void) | undefined;
  });
  jest.spyOn(console, "log").mockImplementation(() => undefined);
  NativeAppBridge({});
});

afterEach(() => {
  dispose?.();
  jest.restoreAllMocks();
});

it("verifies real pin_v5 encryption under the real coordinator without nested writes", async () => {
  const requestId = verify();
  expect(await response()).toEqual([requestId, true]);
  expect(getDeviceEncryptionKey).toHaveBeenCalledWith(false);
  expect(StorageUtil.migrateEncryptedSeed).not.toHaveBeenCalled();
  expect(notifySeedStored).not.toHaveBeenCalled();
  expect(ciphertext).toBe(v5);
  const restored = jest.fn(async () => undefined);
  await bounded(walletMutations.enqueueRestore(restored));
  expect(restored).toHaveBeenCalledTimes(1);
  await bounded(
    walletMutations.clear(() => {
      ciphertext = null;
    }),
  );
  expect(ciphertext).toBeNull();
});

it("returns a correlated wrong-PIN failure and leaves the queue usable", async () => {
  const requestId = verify("654321");
  expect(await response()).toEqual([requestId, false, "Incorrect PIN"]);
  await bounded(walletMutations.enqueueRestore(async () => undefined));
  expect(ciphertext).toBe(v5);
  expect(notifySeedStored).not.toHaveBeenCalled();
});

it("reports a missing device factor without creating it or modifying ciphertext", async () => {
  jest
    .mocked(getDeviceEncryptionKey)
    .mockRejectedValue(new DeviceCredentialUnavailableError());
  const requestId = verify();
  expect(await response()).toEqual([
    requestId,
    false,
    "Wallet device credential unavailable",
  ]);
  expect(getDeviceEncryptionKey).toHaveBeenCalledWith(false);
  expect(ciphertext).toBe(v5);
  expect(StorageUtil.migrateEncryptedSeed).not.toHaveBeenCalled();
});

it("checks decrypted account binding before PIN success", async () => {
  jest.mocked(StorageUtil.getActiveAccount).mockResolvedValue(OTHER_ADDRESS);
  const requestId = verify();
  expect(await response()).toEqual([requestId, false, "Incorrect PIN"]);
  expect(notifySeedStored).not.toHaveBeenCalled();
});

it("returns no secret material from the verification API", async () => {
  await expect(
    verifyStoredSeedPinAsync(
      ADDRESS,
      v5,
      PIN,
      walletMutations.captureGeneration(),
    ),
  ).resolves.toBeUndefined();
});

it("drains verification after a concurrent clear without restoring state or reporting success", async () => {
  let release!: (key: CryptoKey) => void;
  let started!: () => void;
  const decryptStarted = new Promise<void>((resolve) => {
    started = resolve;
  });
  jest.mocked(getDeviceEncryptionKey).mockImplementationOnce(() => {
    started();
    return new Promise((resolve) => {
      release = resolve;
    });
  });
  const requestId = verify();
  await decryptStarted;
  const clear = walletMutations.clear(() => {
    ciphertext = null;
  });
  release(deviceKey);
  await bounded(clear);
  expect(await response()).toEqual([
    requestId,
    false,
    "Wallet changed during PIN verification",
  ]);
  expect(ciphertext).toBeNull();
  expect(StorageUtil.migrateEncryptedSeed).not.toHaveBeenCalled();
  expect(notifySeedStored).not.toHaveBeenCalled();
  await bounded(walletMutations.enqueueRestore(async () => undefined));
});

it("verifies legacy v4 without factor creation, then retains normal unlock migration", async () => {
  ciphertext = v4;
  jest
    .mocked(getDeviceEncryptionKey)
    .mockRejectedValue(new DeviceCredentialUnavailableError());
  const requestId = verify();
  expect(await response()).toEqual([requestId, true]);
  expect(getDeviceEncryptionKey).not.toHaveBeenCalled();
  expect(ciphertext).toBe(v4);
  expect(StorageUtil.migrateEncryptedSeed).not.toHaveBeenCalled();
  expect(notifySeedStored).not.toHaveBeenCalled();

  jest.mocked(getDeviceEncryptionKey).mockResolvedValue(deviceKey);
  await expect(
    bounded(decryptStoredSeedWithPin(BLOCKCHAIN, ADDRESS, v4, PIN)),
  ).resolves.toEqual(SEED);
  expect(getDeviceEncryptionKey).toHaveBeenCalledWith(true);
  expect(JSON.parse(ciphertext ?? "{}").version).toBe("pin_v5");
  expect(notifySeedStored).toHaveBeenCalledTimes(1);
});
