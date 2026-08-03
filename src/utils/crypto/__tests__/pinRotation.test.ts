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

const TEST_ADDRESS = `Q${"12".repeat(20)}`;
const MAIN_ADDRESS = `Q${"34".repeat(20)}`;
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

const mockGetAll = StorageUtil.getAllEncryptedSeeds as jest.MockedFunction<
  typeof StorageUtil.getAllEncryptedSeeds
>;
const mockReplace =
  StorageUtil.replaceEncryptedSeedSetIfUnchanged as jest.MockedFunction<
    typeof StorageUtil.replaceEncryptedSeedSetIfUnchanged
  >;
const mockDecrypt = decryptSeedAsync as jest.MockedFunction<
  typeof decryptSeedAsync
>;
const mockEncrypt = encryptSeedAsync as jest.MockedFunction<
  typeof encryptSeedAsync
>;
const mockDeriveAddress =
  deriveCanonicalAddressFromHexSeed as jest.MockedFunction<
    typeof deriveCanonicalAddressFromHexSeed
  >;

describe("cross-network PIN rotation", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetAll.mockImplementation(async (blockchain) =>
      blockchain === "TEST_NET" ? [{ ...TEST_SEED }] : [{ ...MAIN_SEED }],
    );
    mockDecrypt.mockImplementation(async (encryptedSeed) => ({
      mnemonic:
        encryptedSeed === "old-test" ? "mnemonic-test" : "mnemonic-main",
      hexSeed: encryptedSeed === "old-test" ? "hex-test" : "hex-main",
    }));
    mockEncrypt.mockImplementation(
      async (_mnemonic, hexSeed) => `new-${hexSeed}`,
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

  it("restores old ciphertext under a higher revision when any native ACK fails", async () => {
    const backup = jest
      .fn<Promise<unknown>, [PinRotationBackupRecord]>()
      .mockImplementation(async (record) => {
        if (
          record.blockchain === "MAIN_NET" &&
          record.encryptedSeed.startsWith("new-")
        ) {
          throw new Error("native disk full");
        }
        return {};
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
