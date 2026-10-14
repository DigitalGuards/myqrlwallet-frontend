/** @jest-environment jsdom */
import { getRemainingAttempts, checkLockout, recordFailedAttempt } from "../pinAttemptTracker";
jest.mock("@/utils/storage/storage", () => ({
  __esModule: true,
  default: {
    getAllEncryptedSeeds: jest.fn(),
    replaceEncryptedSeedSetIfUnchanged: jest.fn(),
  },
}));

jest.mock("../cryptoWorkerClient", () => ({
  CryptoErrorCode: {
    INCORRECT_PIN: "INCORRECT_PIN",
  },
  CryptoOperationError: class MockCryptoOperationError extends Error {
    code: string;

    constructor(errorCode: string, message: string) {
      super(message);
      this.code = errorCode;
      this.name = "CryptoOperationError";
    }
  },
  decryptSeedAsync: jest.fn(),
  encryptSeedAsync: jest.fn(),
}));

jest.mock("../seedIdentity", () => ({
  deriveCanonicalAddressFromHexSeed: jest.fn(),
}));

import StorageUtil, { type EncryptedSeedData } from "@/utils/storage/storage";
import {
  CryptoErrorCode,
  CryptoOperationError,
  decryptSeedAsync,
  encryptSeedAsync,
} from "../cryptoWorkerClient";
import {
  rotateStoredSeedPin,
  rotateStoredSeedPinWithTargetFallback,
  type PinRotationBackupRecord,
} from "../pinRotation";
import { deriveCanonicalAddressFromHexSeed } from "../seedIdentity";

const TEST_ADDRESS = `Q${"12".repeat(64)}`;
const MAIN_ADDRESS = `Q${"34".repeat(64)}`;
const TEST_SEED: EncryptedSeedData = {
  address: TEST_ADDRESS,
  encryptedSeed: "old-test",
  lastAccessed: 10,
  revision: 2,
};
const MAIN_SEED: EncryptedSeedData = {
  address: MAIN_ADDRESS,
  encryptedSeed: "old-main",
  lastAccessed: 20,
  revision: 5,
};

const mockedStorageUtil = jest.mocked(StorageUtil);

const mockGetAll = mockedStorageUtil.getAllEncryptedSeeds;
const mockReplace = mockedStorageUtil.replaceEncryptedSeedSetIfUnchanged;
const mockDecrypt = jest.mocked(decryptSeedAsync);
const mockEncrypt = jest.mocked(encryptSeedAsync);
const mockDeriveAddress = jest.mocked(deriveCanonicalAddressFromHexSeed);

describe("cross-network PIN rotation", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    localStorage.clear();
    mockGetAll.mockImplementation((blockchain) =>
      Promise.resolve(blockchain === "TEST_NET" ? [{ ...TEST_SEED }] : [{ ...MAIN_SEED }]),
    );
    mockDecrypt.mockImplementation((encryptedSeed) => Promise.resolve({
      mnemonic: encryptedSeed === "old-test" ? "mnemonic-test" : "mnemonic-main",
      hexSeed: encryptedSeed === "old-test" ? "hex-test" : "hex-main",
    }));
    mockEncrypt.mockImplementation(
      (_mnemonic, hexSeed) => Promise.resolve(`new-${hexSeed}`),
    );
    mockDeriveAddress.mockImplementation((hexSeed) =>
      hexSeed === "hex-test" ? TEST_ADDRESS : MAIN_ADDRESS,
    );
    mockReplace.mockResolvedValue(true);
  });

  it("rotates and durably acknowledges every configured network before success", async () => {
    const backup = jest
      .fn<Promise<unknown>, [PinRotationBackupRecord]>()
      .mockResolvedValue({});
    await expect(
      rotateStoredSeedPin({
        blockchains: ["TEST_NET", "MAIN_NET"],
        oldPin: "1234",
        newPin: "5678",
        backup,
      }),
    ).resolves.toEqual({ rotatedSeeds: 2 });

    expect(mockDecrypt).toHaveBeenCalledTimes(2);
    expect(mockReplace).toHaveBeenCalledTimes(2);
    expect(backup).toHaveBeenCalledTimes(2);
    expect(backup.mock.calls.map(([record]) => record)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          blockchain: "TEST_NET",
          encryptedSeed: "new-hex-test",
          revision: 3,
        }),
        expect.objectContaining({
          blockchain: "MAIN_NET",
          encryptedSeed: "new-hex-main",
          revision: 6,
        }),
      ]),
    );
  });

  it("sends backups one at a time in record order, rollback included, for 6 records", async () => {
    const seeds = Array.from({ length: 6 }, (_, i) => ({
      address: `Q${String(i + 1).repeat(128)}`,
      encryptedSeed: `old-${i}`,
      lastAccessed: 10,
      revision: 1,
    }));
    mockGetAll.mockImplementation((blockchain) =>
      Promise.resolve(blockchain === "TEST_NET" ? seeds.map((seed) => ({ ...seed })) : []),
    );
    mockDecrypt.mockImplementation((encryptedSeed) => Promise.resolve({
      mnemonic: `m-${encryptedSeed}`,
      hexSeed: encryptedSeed,
    }));
    mockEncrypt.mockImplementation((_m, hexSeed) => Promise.resolve(`new-${hexSeed}`));
    mockDeriveAddress.mockImplementation((hexSeed) => {
      const index = Number(hexSeed.slice(4));
      return seeds[index]?.address ?? TEST_ADDRESS;
    });

    let inFlight = 0;
    let maxInFlight = 0;
    const order: string[] = [];
    const backup = jest
      .fn<Promise<unknown>, [PinRotationBackupRecord]>()
      .mockImplementation(async (record) => {
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        order.push(record.encryptedSeed);
        await new Promise((resolve) => setTimeout(resolve, 1));
        inFlight -= 1;
        // Fail the last forward record to force the rollback wave.
        if (record.encryptedSeed === "new-old-5") throw new Error("nope");
        return {};
      });

    await expect(
      rotateStoredSeedPin({
        blockchains: ["TEST_NET"],
        oldPin: "1234",
        newPin: "5678",
        backup,
      }),
    ).rejects.toThrow(/old PIN remains active/);

    expect(maxInFlight).toBe(1);
    expect(order).toEqual([
      ...seeds.map((_, i) => `new-old-${i}`),
      ...seeds.map((_, i) => `old-${i}`),
    ]);
  });

  it("restores old ciphertext under a higher revision when any native ACK fails", async () => {
    const backup = jest
      .fn<Promise<unknown>, [PinRotationBackupRecord]>()
      .mockImplementation((record) => {
        if (
          record.blockchain === "MAIN_NET" &&
          record.encryptedSeed.startsWith("new-")
        ) {
          return Promise.reject(new Error("native disk full"));
        }
        return Promise.resolve({});
      });

    await expect(
      rotateStoredSeedPin({
        blockchains: ["TEST_NET", "MAIN_NET"],
        oldPin: "1234",
        newPin: "5678",
        backup,
      }),
    ).rejects.toThrow(/old PIN remains active/);

    expect(mockReplace).toHaveBeenCalledTimes(4);
    expect(backup).toHaveBeenCalledTimes(4);
    expect(backup.mock.calls.map(([record]) => record)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ encryptedSeed: "old-test", revision: 4 }),
        expect.objectContaining({ encryptedSeed: "old-main", revision: 7 }),
      ]),
    );
  });

  it("rejects a ciphertext/account mismatch before writing either network", async () => {
    mockDeriveAddress.mockReturnValue(MAIN_ADDRESS);

    await expect(
      rotateStoredSeedPin({
        blockchains: ["TEST_NET", "MAIN_NET"],
        oldPin: "1234",
        newPin: "5678",
      }),
    ).rejects.toThrow(/stored seed does not match/);
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it("rolls back a network already written when a later snapshot loses its CAS", async () => {
    mockReplace
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);

    await expect(
      rotateStoredSeedPin({
        blockchains: ["TEST_NET", "MAIN_NET"],
        oldPin: "1234",
        newPin: "5678",
      }),
    ).rejects.toThrow(/Wallet changed while rotating PIN for MAIN_NET/);
    expect(mockReplace).toHaveBeenCalledTimes(3);
    expect(mockReplace.mock.calls[2]?.[2]).toEqual([
      expect.objectContaining({ encryptedSeed: "old-test", revision: 4 }),
    ]);
  });

  it("converges on the target PIN when timeout compensation finds it already active", async () => {
    mockDecrypt.mockRejectedValueOnce(
      new CryptoOperationError(CryptoErrorCode.INCORRECT_PIN, "Incorrect PIN"),
    );

    await expect(
      rotateStoredSeedPinWithTargetFallback(
        {
          blockchains: ["TEST_NET", "MAIN_NET"],
          oldPin: "5678",
          newPin: "1234",
        },
        true,
      ),
    ).resolves.toEqual({ rotatedSeeds: 2 });

    expect(mockDecrypt.mock.calls.map(([, pin]) => pin)).toEqual([
      "5678",
      "5678",
      "1234",
      "1234",
    ]);
    expect(mockReplace).toHaveBeenCalledTimes(2);
  });
});


it("counts one failure across multiple seed records and refuses the sixth rotation", async () => {
  localStorage.clear();
  mockGetAll.mockResolvedValue([{ ...TEST_SEED }, { ...MAIN_SEED }]);
  mockDecrypt
    .mockReset()
    .mockRejectedValue(
      new CryptoOperationError(CryptoErrorCode.INCORRECT_PIN, "Incorrect PIN"),
    );
  const options = { blockchains: ["TEST_NET"], oldPin: "9999", newPin: "1234" };
  for (let attempt = 1; attempt <= 6; attempt++) {
    await expect(rotateStoredSeedPin(options)).rejects.toMatchObject({
      attemptsLeft: Math.max(0, 5 - attempt),
    });
  }
  expect(mockDecrypt).toHaveBeenCalledTimes(10);
  expect(checkLockout().isLocked).toBe(true);
});

it("resets the PIN failures before a subsequent encryption error", async () => {
  localStorage.clear();
  recordFailedAttempt();
  mockGetAll.mockResolvedValue([{ ...TEST_SEED }]);
  mockDecrypt.mockResolvedValue({ mnemonic: "fixture", hexSeed: "hex-test" });
  mockDeriveAddress.mockReturnValue(TEST_ADDRESS);
  mockEncrypt.mockRejectedValue(new Error("Encryption unavailable"));
  await expect(
    rotateStoredSeedPin({
      blockchains: ["TEST_NET"],
      oldPin: "1234",
      newPin: "5678",
    }),
  ).rejects.toThrow("Encryption unavailable");
  expect(getRemainingAttempts()).toBe(5);
});

it("counts one attempt per wrong recovery call and refuses while locked", async () => {
  localStorage.clear();
  mockGetAll.mockResolvedValue([{ ...TEST_SEED }]);
  mockDecrypt
    .mockReset()
    .mockRejectedValue(
      new CryptoOperationError(CryptoErrorCode.INCORRECT_PIN, "Incorrect PIN"),
    );
  const options = { blockchains: ["TEST_NET"], oldPin: "9988", newPin: "8877" };
  for (const attemptsLeft of [4, 3, 2, 1]) {
    await expect(
      rotateStoredSeedPinWithTargetFallback(options, true),
    ).rejects.toMatchObject({ isLocked: false, attemptsLeft });
  }
  await expect(
    rotateStoredSeedPinWithTargetFallback(options, true),
  ).rejects.toMatchObject({ isLocked: true });
  // Each call probed the current PIN, then the target PIN.
  expect(mockDecrypt.mock.calls.map(([, pin]) => pin)).toEqual(
    Array.from({ length: 5 }, () => ["9988", "8877"]).flat(),
  );
  await expect(
    rotateStoredSeedPinWithTargetFallback(options, true),
  ).rejects.toMatchObject({ isLocked: true });
  expect(mockDecrypt).toHaveBeenCalledTimes(10);
});
