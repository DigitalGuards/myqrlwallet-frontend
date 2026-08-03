/**
 * Serializes native restores and PIN rotations, then gives an explicit wallet
 * wipe a final cleanup pass after every mutation that was already running.
 * This prevents late async work from recreating wallet state after clear.
 */
import {
  advanceWalletEpoch,
  getWalletEpoch,
  isWalletEpochCurrent,
  type WalletEpoch,
  withWalletMutationLock,
} from "./walletEpoch";

export interface WalletMutationToken {
  generation: number;
  epoch: WalletEpoch;
}

export interface WalletMutationGuard {
  (): boolean;
  readonly epoch: WalletEpoch;
}

export class NativeWalletMutationCoordinator {
  private generation = 0;
  private mutationQueue: Promise<void> = Promise.resolve();
  private clearInProgress = false;
  private clearPromise: Promise<void> | null = null;

  isCurrent(token: WalletMutationToken): boolean {
    return (
      !this.clearInProgress &&
      token.generation === this.generation &&
      isWalletEpochCurrent(token.epoch)
    );
  }

  captureGeneration(): WalletMutationToken {
    return { generation: this.generation, epoch: getWalletEpoch() };
  }

  private guardFor(token: WalletMutationToken): WalletMutationGuard {
    const guard = () => this.isCurrent(token);
    return Object.assign(guard, { epoch: token.epoch });
  }

  enqueueRestore(
    restore: (isCurrent: WalletMutationGuard) => Promise<void>,
  ): Promise<void> {
    if (this.clearInProgress) return Promise.resolve();

    const token = this.captureGeneration();
    const operation = this.mutationQueue
      .catch(() => undefined)
      .then(async () => {
        if (!this.isCurrent(token)) return;
        await withWalletMutationLock(async () => {
          if (!this.isCurrent(token)) return;
          await restore(this.guardFor(token));
        });
      });
    this.mutationQueue = operation.then(
      () => undefined,
      () => undefined,
    );
    return operation;
  }

  enqueuePinChange(
    operation: (isCurrent: WalletMutationGuard) => Promise<void>,
    onDiscard: () => void | Promise<void>,
  ): Promise<void> {
    return this.enqueueWalletMutation(operation, onDiscard);
  }

  enqueueWalletMutation<T>(
    operation: (isCurrent: WalletMutationGuard) => Promise<T>,
    onDiscard: () => T | Promise<T>,
    expectedGeneration: WalletMutationToken = this.captureGeneration(),
  ): Promise<T> {
    if (this.clearInProgress || !this.isCurrent(expectedGeneration)) {
      return Promise.resolve().then(onDiscard);
    }

    const token = expectedGeneration;
    const queued = this.mutationQueue
      .catch(() => undefined)
      .then(async () => {
        if (!this.isCurrent(token)) {
          return onDiscard();
        }
        return withWalletMutationLock(async () => {
          if (!this.isCurrent(token)) return onDiscard();
          return operation(this.guardFor(token));
        });
      });
    this.mutationQueue = queued.then(
      () => undefined,
      () => undefined,
    );
    return queued;
  }

  clear(
    clearStorage: () => void | Promise<void>,
    clearRuntimeState?: () => void | Promise<void>,
  ): Promise<void> {
    if (this.clearPromise) return this.clearPromise;

    this.clearInProgress = true;
    this.generation += 1;
    // Persist and publish the identity boundary before any async cleanup.
    // Other tabs invalidate queued writes and tear down live dApp sessions.
    let epochPublicationError: unknown = null;
    try {
      advanceWalletEpoch();
    } catch (error) {
      // Continue every local cleanup pass, but retain this failure. A volatile
      // generation protects this realm only; reporting durable success would
      // let another tab reload the old persisted epoch and revive stale state.
      epochPublicationError = error;
      console.error(
        "[WalletMutation] Could not publish wallet clear epoch:",
        error,
      );
    }
    const pendingMutations = this.mutationQueue.catch(() => undefined);

    this.clearPromise = (async () => {
      let cleanupError: unknown = null;
      const attempt = async (
        operation: (() => void | Promise<void>) | undefined,
      ): Promise<void> => {
        if (!operation) return;
        try {
          await operation();
        } catch (error) {
          cleanupError ??= error;
          console.error("[WalletMutation] Wallet clear step failed:", error);
        }
      };

      // Remove sensitive state immediately, then sweep again after any restore
      // or PIN rotation that had already crossed an await before invalidation.
      await attempt(clearStorage);
      await pendingMutations;
      try {
        await withWalletMutationLock(async () => {
          // This lock drains mutations running in other tabs. Their captured
          // epoch is now stale, so queued mutations discard before they write.
          await attempt(clearStorage);
          await attempt(clearRuntimeState);
          // Runtime cleanup can cross awaits and trigger storage reactions.
          // Keep restores blocked until one final sweep has completed.
          await attempt(clearStorage);
        });
      } catch (error) {
        cleanupError ??= error;
        console.error("[WalletMutation] Wallet clear lock failed:", error);
      }

      if (epochPublicationError !== null) throw epochPublicationError;
      if (cleanupError !== null) throw cleanupError;
    })().finally(() => {
      this.clearInProgress = false;
      this.clearPromise = null;
    });

    return this.clearPromise;
  }
}

/** One origin-realm barrier shared by UI and native bridge mutation paths. */
export const walletMutations = new NativeWalletMutationCoordinator();
