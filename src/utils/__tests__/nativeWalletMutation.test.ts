import { NativeWalletMutationCoordinator } from "../nativeWalletMutation";

describe("native wallet mutation coordination", () => {
  it("sweeps state recreated by a restore that was already in flight during wipe", async () => {
    const coordinator = new NativeWalletMutationCoordinator();
    const walletState = new Set<string>();
    let releaseRestore!: () => void;
    const restoreBlocked = new Promise<void>((resolve) => {
      releaseRestore = resolve;
    });

    const restore = coordinator.enqueueRestore(async (isCurrent) => {
      await restoreBlocked;
      // Model a dependency that mutates after its own await and cannot be
      // interrupted by the caller's generation check.
      walletState.add("ghost-account");
      expect(isCurrent()).toBe(false);
    });

    const clear = coordinator.clear(() => walletState.clear());
    releaseRestore();
    await Promise.all([restore, clear]);

    expect(walletState).toEqual(new Set());
  });

  it("drops restores that arrive after a wipe starts", async () => {
    const coordinator = new NativeWalletMutationCoordinator();
    let releaseClear!: () => void;
    const clearBlocked = new Promise<void>((resolve) => {
      releaseClear = resolve;
    });
    let restoreRan = false;

    const clear = coordinator.clear(async () => clearBlocked);
    await coordinator.enqueueRestore(async () => {
      restoreRan = true;
    });
    releaseClear();
    await clear;

    expect(restoreRan).toBe(false);
  });

  it("keeps restores blocked through runtime cleanup and the final sweep", async () => {
    const coordinator = new NativeWalletMutationCoordinator();
    const walletState = new Set<string>(["wallet"]);
    let releaseRuntimeClear!: () => void;
    const runtimeClearBlocked = new Promise<void>((resolve) => {
      releaseRuntimeClear = resolve;
    });
    let runtimeClearStarted!: () => void;
    const runtimeClearStart = new Promise<void>((resolve) => {
      runtimeClearStarted = resolve;
    });
    let restoreRan = false;

    const clear = coordinator.clear(
      () => walletState.clear(),
      async () => {
        runtimeClearStarted();
        await runtimeClearBlocked;
        // Model a storage reaction produced while runtime state is clearing.
        walletState.add("runtime-reaction");
      },
    );
    await runtimeClearStart;

    await coordinator.enqueueRestore(async () => {
      restoreRan = true;
      walletState.add("ghost-account");
    });
    releaseRuntimeClear();
    await clear;

    expect(restoreRan).toBe(false);
    expect(walletState).toEqual(new Set());
  });

  it("drains a stale PIN rotation before the final wipe and rejects its success", async () => {
    const coordinator = new NativeWalletMutationCoordinator();
    const walletState = new Set<string>(["old-seed"]);
    const responses: string[] = [];
    let releaseRotation!: () => void;
    let rotationStarted!: () => void;
    const rotationBlocked = new Promise<void>((resolve) => {
      releaseRotation = resolve;
    });
    const rotationStart = new Promise<void>((resolve) => {
      rotationStarted = resolve;
    });

    const rotation = coordinator.enqueuePinChange(
      async (isCurrent) => {
        rotationStarted();
        await rotationBlocked;
        // Model both a late CAS write and a compensating rollback write.
        walletState.add("new-pin-ciphertext");
        walletState.add("rollback-ciphertext");
        responses.push(isCurrent() ? "success" : "wallet-cleared");
      },
      () => {
        responses.push("wallet-cleared");
      },
    );
    await rotationStart;

    const clear = coordinator.clear(() => walletState.clear());
    releaseRotation();
    await Promise.all([rotation, clear]);

    expect(walletState).toEqual(new Set());
    expect(responses).toEqual(["wallet-cleared"]);
  });

  it("serializes timeout compensation behind the original PIN rotation", async () => {
    const coordinator = new NativeWalletMutationCoordinator();
    const order: string[] = [];
    let releaseOriginal!: () => void;
    const originalBlocked = new Promise<void>((resolve) => {
      releaseOriginal = resolve;
    });

    const original = coordinator.enqueuePinChange(
      async () => {
        order.push("original-start");
        await originalBlocked;
        order.push("original-finish");
      },
      () => undefined,
    );
    const compensation = coordinator.enqueuePinChange(
      async () => {
        order.push("compensation");
      },
      () => undefined,
    );

    await Promise.resolve();
    await Promise.resolve();
    expect(order).toEqual(["original-start"]);
    releaseOriginal();
    await Promise.all([original, compensation]);
    expect(order).toEqual([
      "original-start",
      "original-finish",
      "compensation",
    ]);
  });

  it("sweeps an account seed write that finishes after clear starts", async () => {
    const coordinator = new NativeWalletMutationCoordinator();
    const walletState = new Set<string>();
    let releaseEncryption!: () => void;
    let encryptionStarted!: () => void;
    const encryptionBlocked = new Promise<void>((resolve) => {
      releaseEncryption = resolve;
    });
    const encryptionStart = new Promise<void>((resolve) => {
      encryptionStarted = resolve;
    });
    let reportedCreated = false;

    const creation = coordinator.enqueueWalletMutation(
      async (isCurrent) => {
        encryptionStarted();
        await encryptionBlocked;
        walletState.add("late-created-seed");
        if (isCurrent()) reportedCreated = true;
      },
      () => undefined,
    );
    await encryptionStart;
    const clear = coordinator.clear(() => walletState.clear());
    releaseEncryption();
    await Promise.all([creation, clear]);

    expect(walletState).toEqual(new Set());
    expect(reportedCreated).toBe(false);
  });

  it("invalidates a late seed writer owned by another same-origin realm", async () => {
    const writerTab = new NativeWalletMutationCoordinator();
    const clearingTab = new NativeWalletMutationCoordinator();
    const walletState = new Set<string>();
    let releaseWrite: () => void = () => undefined;
    const writeGate = new Promise<void>((resolve) => {
      releaseWrite = resolve;
    });
    let markWriteStarted: () => void = () => undefined;
    const writeStarted = new Promise<void>((resolve) => {
      markWriteStarted = resolve;
    });

    const write = writerTab.enqueueWalletMutation(
      async (isCurrent) => {
        markWriteStarted();
        await writeGate;
        if (isCurrent()) walletState.add("stale-cross-tab-seed");
      },
      () => undefined,
    );
    await writeStarted;

    const clear = clearingTab.clear(() => walletState.clear());
    releaseWrite();
    await Promise.all([write, clear]);

    expect(walletState).toEqual(new Set());
  });

  it("finishes every sweep but rejects durable success when epoch persistence fails", async () => {
    const originalStorage = Object.getOwnPropertyDescriptor(
      globalThis,
      "localStorage",
    );
    const values = new Map<string, string>();
    const failingStorage: Storage = {
      get length() {
        return values.size;
      },
      clear: () => values.clear(),
      getItem: (key) => values.get(key) ?? null,
      key: (index) => [...values.keys()][index] ?? null,
      removeItem: (key) => values.delete(key),
      setItem: () => {
        throw new Error("epoch storage denied");
      },
    };
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: failingStorage,
    });
    const errorSpy = jest
      .spyOn(console, "error")
      .mockImplementation(() => undefined);

    try {
      const coordinator = new NativeWalletMutationCoordinator();
      let sweepCount = 0;
      await expect(
        coordinator.clear(() => {
          sweepCount++;
        }),
      ).rejects.toThrow("persist the wallet clear boundary");
      expect(sweepCount).toBe(3);

      let laterMutationRan = false;
      await coordinator.enqueueWalletMutation(
        async () => {
          laterMutationRan = true;
        },
        () => undefined,
      );
      expect(laterMutationRan).toBe(true);
    } finally {
      errorSpy.mockRestore();
      if (originalStorage) {
        Object.defineProperty(globalThis, "localStorage", originalStorage);
      } else {
        Reflect.deleteProperty(globalThis, "localStorage");
      }
    }
  });
});
