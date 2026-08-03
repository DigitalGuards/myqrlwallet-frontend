import StorageUtil, { type EncryptedSeedData } from "@/utils/storage/storage";
import {
  CryptoErrorCode,
  CryptoOperationError,
  decryptSeedAsync,
  encryptSeedAsync,
} from "./cryptoWorkerClient";
import {
  getWalletEpoch,
  isWalletEpochCurrent,
  type WalletEpoch,
} from "@/utils/walletEpoch";
import { deriveCanonicalAddressFromHexSeed } from "./seedIdentity";

export interface PinRotationBackupRecord {
  blockchain: string;
  address: string;
  encryptedSeed: string;
  revision: number;
}

export interface RotateStoredSeedPinOptions {
  blockchains: string[];
  oldPin: string;
  newPin: string;
  backup?: (record: PinRotationBackupRecord) => Promise<unknown>;
  walletEpoch?: WalletEpoch;
  isCurrent?: () => boolean;
}

interface PreparedChain {
  blockchain: string;
  original: EncryptedSeedData[];
  updated: EncryptedSeedData[];
  rollback: EncryptedSeedData[];
}

function revisionOf(seed: EncryptedSeedData): number {
  return Number.isSafeInteger(seed.revision) && (seed.revision ?? 0) >= 0
    ? (seed.revision ?? 0)
    : 0;
}

function toBackupRecords(
  chains: PreparedChain[],
  field: "updated" | "rollback",
) {
  return chains.flatMap((chain) =>
    chain[field].map((seed) => ({
      blockchain: chain.blockchain,
      address: seed.address,
      encryptedSeed: seed.encryptedSeed,
      revision: revisionOf(seed),
    })),
  );
}

async function rollbackLocalWrites(
  chains: PreparedChain[],
  written: Set<string>,
  expectedEpoch: WalletEpoch,
  isCurrent: () => boolean,
): Promise<void> {
  if (!isCurrent()) return;
  const failed: string[] = [];
  for (const chain of [...chains].reverse()) {
    if (!written.has(chain.blockchain)) continue;
    try {
      const replaced = await StorageUtil.replaceEncryptedSeedSetIfUnchanged(
        chain.blockchain,
        chain.updated,
        chain.rollback,
        expectedEpoch,
      );
      if (!replaced) failed.push(chain.blockchain);
    } catch {
      failed.push(chain.blockchain);
    }
  }
  if (failed.length > 0) {
    throw new Error(
      `PIN rotation rollback could not restore: ${failed.join(", ")}`,
    );
  }
}

/**
 * Rotate every configured network's local seed records as one guarded unit.
 *
 * Local writes use compare-and-swap snapshots. Native callers additionally
 * await a durable acknowledgement for every ciphertext. If any acknowledgement
 * fails, compensating records restore the old ciphertext under a higher
 * revision both locally and natively, preventing a late/stale restore from
 * reintroducing the partially rotated value.
 */
export async function rotateStoredSeedPin(
  options: RotateStoredSeedPinOptions,
): Promise<{ rotatedSeeds: number }> {
  const expectedEpoch = options.walletEpoch ?? getWalletEpoch();
  const isCurrent = () =>
    isWalletEpochCurrent(expectedEpoch) && (options.isCurrent?.() ?? true);
  const assertCurrent = () => {
    if (!isCurrent())
      throw new Error("Wallet identity changed during PIN rotation");
  };

  assertCurrent();
  const uniqueBlockchains = [...new Set(options.blockchains)];
  const originals = await Promise.all(
    uniqueBlockchains.map(async (blockchain) => ({
      blockchain,
      seeds: await StorageUtil.getAllEncryptedSeeds(blockchain),
    })),
  );
  const totalSeeds = originals.reduce(
    (count, chain) => count + chain.seeds.length,
    0,
  );
  if (totalSeeds === 0) throw new Error("No encrypted seeds found");

  assertCurrent();
  const prepared = await Promise.all(
    originals
      .filter(({ seeds }) => seeds.length > 0)
      .map(async ({ blockchain, seeds }): Promise<PreparedChain> => {
        const updated = await Promise.all(
          seeds.map(async (seed) => {
            assertCurrent();
            const decrypted = await decryptSeedAsync(
              seed.encryptedSeed,
              options.oldPin,
            );
            const derivedAddress = deriveCanonicalAddressFromHexSeed(
              decrypted.hexSeed,
            );
            if (derivedAddress !== seed.address) {
              throw new Error(
                `Security error: stored seed does not match ${seed.address} on ${blockchain}`,
              );
            }
            assertCurrent();
            return {
              ...seed,
              encryptedSeed: await encryptSeedAsync(
                decrypted.mnemonic,
                decrypted.hexSeed,
                options.newPin,
              ),
              lastAccessed: Date.now(),
              revision: revisionOf(seed) + 1,
            };
          }),
        );
        const rollback = seeds.map((seed, index) => ({
          ...seed,
          lastAccessed: Date.now(),
          revision: revisionOf(updated[index] ?? seed) + 1,
        }));
        return { blockchain, original: seeds, updated, rollback };
      }),
  );

  const written = new Set<string>();
  try {
    for (const chain of prepared) {
      assertCurrent();
      const replaced = await StorageUtil.replaceEncryptedSeedSetIfUnchanged(
        chain.blockchain,
        chain.original,
        chain.updated,
        expectedEpoch,
      );
      if (!replaced) {
        throw new Error(
          `Wallet changed while rotating PIN for ${chain.blockchain}`,
        );
      }
      written.add(chain.blockchain);
    }
  } catch (writeError) {
    try {
      await rollbackLocalWrites(prepared, written, expectedEpoch, isCurrent);
    } catch (rollbackError) {
      throw new Error(
        `${writeError instanceof Error ? writeError.message : String(writeError)}; ${
          rollbackError instanceof Error
            ? rollbackError.message
            : String(rollbackError)
        }`,
      );
    }
    throw writeError;
  }

  assertCurrent();
  if (!options.backup) return { rotatedSeeds: totalSeeds };

  const backupResults = await Promise.allSettled(
    toBackupRecords(prepared, "updated").map((record) =>
      Promise.resolve().then(() => {
        assertCurrent();
        return options.backup?.(record);
      }),
    ),
  );
  assertCurrent();
  const backupFailed = backupResults.some(
    (result) => result.status === "rejected",
  );
  if (!backupFailed) return { rotatedSeeds: totalSeeds };

  let localRollbackError: unknown;
  try {
    await rollbackLocalWrites(prepared, written, expectedEpoch, isCurrent);
  } catch (error) {
    localRollbackError = error;
  }

  // Compensate every native record, not only the requests known to have
  // resolved: a timed-out request may still have committed just before its ACK
  // was lost. The higher rollback revision deterministically wins either way.
  const rollbackBackupResults = await Promise.allSettled(
    toBackupRecords(prepared, "rollback").map((record) =>
      Promise.resolve().then(() => {
        assertCurrent();
        return options.backup?.(record);
      }),
    ),
  );
  const nativeRollbackFailed = rollbackBackupResults.some(
    (result) => result.status === "rejected",
  );

  if (localRollbackError || nativeRollbackFailed) {
    throw new Error(
      "PIN rotation failed and rollback could not be fully confirmed. Keep the old PIN and re-import any inaccessible account.",
    );
  }
  throw new Error("Native seed backup failed; the old PIN remains active.");
}

/**
 * Apply a requested rotation, or confirm every seed is already encrypted with
 * the target PIN. The second path is reserved for compensating an operation
 * whose response timed out: the original request may have either committed or
 * rolled itself back before its late response arrived.
 */
export async function rotateStoredSeedPinWithTargetFallback(
  options: RotateStoredSeedPinOptions,
  acceptAlreadyTarget: boolean,
): Promise<{ rotatedSeeds: number }> {
  try {
    return await rotateStoredSeedPin(options);
  } catch (error) {
    if (
      !acceptAlreadyTarget ||
      !(error instanceof CryptoOperationError) ||
      error.code !== CryptoErrorCode.INCORRECT_PIN
    ) {
      throw error;
    }

    return rotateStoredSeedPin({
      ...options,
      oldPin: options.newPin,
    });
  }
}
