import { isInNativeApp, notifySeedStored } from "@/utils/nativeApp";
import StorageUtil from "@/utils/storage/storage";
import { WalletEncryptionUtil } from "./walletEncryption";
import {
  walletMutations,
  type WalletMutationToken,
} from "@/utils/nativeWalletMutation";
import { deriveCanonicalAddressFromHexSeed } from "./seedIdentity";

const STALE_WALLET_ERROR = "Wallet changed while the seed was being unlocked";

function assertCurrentWalletGeneration(
  token: ReturnType<typeof walletMutations.captureGeneration>,
): void {
  if (!walletMutations.isCurrent(token)) {
    throw new Error(STALE_WALLET_ERROR);
  }
}

async function syncCurrentV5Backup(
  blockchain: string,
  address: string,
  encryptedSeed: string,
  revision?: number,
  isCurrent: () => boolean = () => true,
): Promise<void> {
  if (!isInNativeApp() || !isCurrent()) return;

  let currentRevision = revision;
  if (!Number.isSafeInteger(currentRevision) || (currentRevision ?? 0) < 1) {
    const current = (await StorageUtil.getAllEncryptedSeeds(blockchain)).find(
      (seed) =>
        seed.address === address && seed.encryptedSeed === encryptedSeed,
    );
    currentRevision = current?.revision;
  }
  if (
    !Number.isSafeInteger(currentRevision) ||
    (currentRevision ?? 0) < 1 ||
    !isCurrent()
  ) {
    return;
  }

  try {
    await notifySeedStored({
      address,
      encryptedSeed,
      blockchain,
      revision: currentRevision as number,
    });
  } catch (error) {
    // A later unlock retries this exact revision. This keeps signing available
    // during a temporary native-storage failure without declaring the stale
    // pin_v4 backup permanently migrated.
    console.warn(
      "[WalletEncryption] Native pin_v5 backup sync deferred.",
      error instanceof Error ? error.message : String(error),
    );
  }
}

/**
 * Decrypt a seed fetched from StorageUtil and lazily migrate authenticated
 * pin_v4 ciphertext to the device-bound pin_v5 envelope.
 *
 * Migration is deliberately best-effort after the PIN has already opened the
 * legacy seed. Encryption is completed before a compare-and-swap write, so a
 * device-store/quota failure leaves the exact v4 blob intact and the user can
 * still transact or retry later. New wallets do not use this fallback: their
 * initial pin_v5 encryption fails closed if the device credential is absent.
 */
export async function decryptStoredSeedWithPin(
  blockchain: string,
  address: string,
  encryptedSeed: string,
  pin: string,
  expectedGeneration: WalletMutationToken = walletMutations.captureGeneration(),
): Promise<{ mnemonic: string; hexSeed: string }> {
  const walletGeneration = expectedGeneration;
  assertCurrentWalletGeneration(walletGeneration);
  const decrypted = await WalletEncryptionUtil.decryptSeedWithPinVersioned(
    encryptedSeed,
    pin,
  );

  // A clear can complete while the device-key/PBKDF2 work is in flight. Never
  // return that now-revoked seed, and never let it enter migration or native
  // backup state after the identity boundary moved.
  assertCurrentWalletGeneration(walletGeneration);

  // Ciphertext is authenticated, but the storage slot key historically was
  // not. A valid blob copied from wallet B into wallet A's slot must not be
  // migrated, backed up, or used to sign as A.
  const decryptedAddress = deriveCanonicalAddressFromHexSeed(
    decrypted.seed.hexSeed,
  );
  if (decryptedAddress !== address) {
    throw new Error("Security error: the stored seed does not match this account");
  }
  assertCurrentWalletGeneration(walletGeneration);

  await walletMutations.enqueueWalletMutation(
    async (isCurrent) => {
      if (!isCurrent()) return;
      if (decrypted.version !== "pin_v4") {
        await syncCurrentV5Backup(
          blockchain,
          address,
          encryptedSeed,
          undefined,
          isCurrent,
        );
        return;
      }

      try {
        const migratedEncryptedSeed =
          await WalletEncryptionUtil.encryptSeedWithPin(
            decrypted.seed.mnemonic,
            decrypted.seed.hexSeed,
            pin,
          );
        if (!isCurrent()) return;
        const migrated = await StorageUtil.migrateEncryptedSeed(
          blockchain,
          address,
          encryptedSeed,
          migratedEncryptedSeed,
          isCurrent.epoch,
        );

        if (migrated) {
          await syncCurrentV5Backup(
            blockchain,
            address,
            migratedEncryptedSeed,
            migrated.revision,
            isCurrent,
          );
        }
      } catch (error) {
        // Encryption or the compare-and-swap failed before a migration committed.
        // Keep a valid PIN unlock usable and retry migration on the next unlock.
        console.warn(
          "[WalletEncryption] Deferred pin_v4 migration; the legacy wallet remains intact.",
          error instanceof Error ? error.message : String(error),
        );
      }
    },
    () => undefined,
    walletGeneration,
  );

  // enqueueWalletMutation discards rather than throws when its captured
  // generation goes stale. Convert that discard into a hard unlock failure so
  // callers can never receive seed material after a concurrent clear.
  assertCurrentWalletGeneration(walletGeneration);
  return decrypted.seed;
}
