import { NativeWalletMutationCoordinator } from "../nativeWalletMutation";
import * as walletEpoch from "../walletEpoch";
import {
  foreignErrorCases,
  errorShapedCases,
} from "./errorFixtures";

const rejectionCases: {
  name: string;
  create: () => unknown;
}[] = [
  ...foreignErrorCases,
  ...errorShapedCases,
  {
    name: "ordinary Error",
    create: () => new Error("cleanup failed"),
  },
  {
    name: "string",
    create: () => "cleanup rejected",
  },
  { name: "null", create: () => null },
  {
    name: "undefined",
    create: () => undefined,
  },
  {
    name: "object",
    create: () => ({ code: "denied" }),
  },
  { name: "incomplete error shape", create: () => ({ name: "Error" }) },
  { name: "malformed error shape", create: () => ({ name: "Error", message: 42 }) },
  { name: "spoofed Error tag", create: () => ({ [Symbol.toStringTag]: "Error" }) },
  { name: "false", create: () => false },
  { name: "zero", create: () => 0 },
  { name: "bigint", create: () => 0n },
  { name: "function", create: () => () => undefined },
  {
    name: "symbol",
    create: () => Symbol("failure"),
  },
];

async function expectCleanupOutcome(
  clearing: Promise<void>,
  failure: unknown,
): Promise<void> {
  const outcome = await clearing.then(
    () => ({ status: "fulfilled" as const }),
    (error: unknown) => ({ status: "rejected" as const, error }),
  );
  if (failure === null) {
    expect(outcome.status).toBe("fulfilled");
    return;
  }
  if (outcome.status !== "rejected")
    throw new Error("Cleanup failure was lost");
  expect(Object.is(outcome.error, failure)).toBe(true);
}

afterEach(() => {
  jest.restoreAllMocks();
});

// Class: delayed failures preserve thrown values, cleanup order and precedence.
describe.each(rejectionCases)(
  "cleanup rejection: $name",
  ({ create }) => {
    it.each(
      ["storage-1", "storage-2", "runtime", "storage-3"].flatMap((step) =>
        ["throw", "reject"].map((delivery) => ({ step, delivery })),
      ),
    )(
      "drains an in-flight restore after $step fails by $delivery",
      async ({ step, delivery }) => {
        const logged = jest
          .spyOn(console, "error")
          .mockImplementation(() => undefined);
        const failure = create();
        const rejectStep = jest
          .fn(() => Promise.resolve())
          .mockRejectedValue(failure);
        const coordinator = new NativeWalletMutationCoordinator();
        const state = new Set(["seed"]);
        const order: string[] = [];
        let releaseRestore: () => void = () => undefined;
        let markStarted: () => void = () => undefined;
        const blocked = new Promise<void>((resolve) => {
          releaseRestore = resolve;
        });
        const started = new Promise<void>((resolve) => {
          markStarted = resolve;
        });
        const restore = coordinator.enqueueRestore(async () => {
          markStarted();
          await blocked;
          state.add("late-seed");
          order.push("restore");
        });
        await started;

        const runStep = (currentStep: string) => {
          order.push(currentStep);
          if (currentStep.startsWith("storage")) state.clear();
          else state.add("runtime-reaction");
          if (currentStep !== step) return;
          if (delivery === "throw") throw failure;
          return rejectStep();
        };
        let sweeps = 0;
        const clearing = coordinator.clear(
          () => runStep(`storage-${++sweeps}`),
          () => runStep("runtime"),
        );
        const observed = expectCleanupOutcome(
          clearing,
          failure,
        );
        // All coordinator entry points stay blocked until the final sweep.
        const discardedRestore = jest.fn(() => Promise.resolve());
        const discardedMutation = jest.fn(() => Promise.resolve());
        const discard = jest.fn();
        const discarded = [
          coordinator.enqueueRestore(discardedRestore),
          coordinator.enqueuePinChange(discardedMutation, discard),
          coordinator.enqueueWalletMutation(discardedMutation, discard),
        ];
        releaseRestore();
        await Promise.all([restore, observed, ...discarded]);

        expect(order).toEqual([
          "storage-1",
          "restore",
          "storage-2",
          "runtime",
          "storage-3",
        ]);
        expect(state.size).toBe(0);
        expect(discardedRestore).not.toHaveBeenCalled();
        expect(discardedMutation).not.toHaveBeenCalled();
        expect(discard).toHaveBeenCalledTimes(2);
        expect(logged).toHaveBeenCalledTimes(1);
        const loggedArgs: unknown[] | undefined = logged.mock.calls[0];
        expect(loggedArgs?.[0]).toBe(
          "[WalletMutation] Wallet clear step failed:",
        );
        expect(loggedArgs?.[1] === failure).toBe(true);
        const later = jest.fn(() => Promise.resolve());
        await coordinator.enqueueRestore(later);
        expect(later).toHaveBeenCalledTimes(1);
      },
    );

    it("finishes cleanup when epoch publication throws and retains that first failure", async () => {
      jest.spyOn(console, "error").mockImplementation(() => undefined);
      const failure = create();
      const epoch = jest
        .spyOn(walletEpoch, "advanceWalletEpoch")
        .mockImplementationOnce(() => {
          throw failure;
        });
      const laterFailure = new Error("later cleanup failure");
      const clearStorage = jest.fn(() => Promise.reject(laterFailure));
      const clearRuntime = jest.fn();
      const coordinator = new NativeWalletMutationCoordinator();
      await expectCleanupOutcome(
        coordinator.clear(clearStorage, clearRuntime),
        failure === null ? laterFailure : failure,
      );
      expect(clearStorage).toHaveBeenCalledTimes(3);
      expect(clearRuntime).toHaveBeenCalledTimes(1);
      epoch.mockRestore();
      await expect(coordinator.clear(() => undefined)).resolves.toBeUndefined();
    });

    it.each(["throw", "reject"])(
      "reports a lock failure by %s after the immediate sweep and releases the barrier",
      async (delivery) => {
        jest.spyOn(console, "error").mockImplementation(() => undefined);
        const failure = create();
        const lock = jest.spyOn(walletEpoch, "withWalletMutationLock");
        if (delivery === "throw") {
          lock.mockImplementationOnce(() => {
            throw failure;
          });
        } else {
          lock.mockRejectedValueOnce(failure);
        }
        const coordinator = new NativeWalletMutationCoordinator();
        const clearStorage = jest.fn();
        const clearRuntime = jest.fn();
        await expectCleanupOutcome(
          coordinator.clear(clearStorage, clearRuntime),
          failure,
        );
        expect(clearStorage).toHaveBeenCalledTimes(1);
        expect(clearRuntime).not.toHaveBeenCalled();
        await expect(coordinator.clear(() => undefined)).resolves.toBeUndefined();
      },
    );
  },
);

describe("native wallet mutation coordination", () => {
  it.each([null, undefined, false, 0, "first failure"])(
    "preserves failure precedence after %p",
    async (firstFailure) => {
      jest.spyOn(console, "error").mockImplementation(() => undefined);
      const laterFailure = new Error("later cleanup failure");
      const clearStorage = jest.fn(() => Promise.resolve());
      clearStorage
        .mockRejectedValueOnce(firstFailure)
        .mockRejectedValueOnce(laterFailure);
      const clearing = new NativeWalletMutationCoordinator().clear(
        clearStorage,
      );
      await expectCleanupOutcome(
        clearing,
        firstFailure ?? laterFailure,
      );
      expect(clearStorage).toHaveBeenCalledTimes(3);
    },
  );
  it.each([
    { failure: new Error("cleanup failed"), name: "Error" },
    { failure: "cleanup rejected", name: "string" },
    { failure: null, name: "null sentinel" },
    { failure: undefined, name: "undefined" },
    { failure: { code: "denied" }, name: "object" },
  ])(
    "finishes cleanup and preserves $name failures",
    async ({ failure }) => {
      const logged = jest
        .spyOn(console, "error")
        .mockImplementation(() => undefined);
      try {
        const coordinator = new NativeWalletMutationCoordinator();
        const clearStorage = jest.fn(() => Promise.resolve());
        clearStorage.mockRejectedValueOnce(failure);
        const clearRuntime = jest.fn(() => Promise.resolve());
        const clearing = coordinator.clear(clearStorage, clearRuntime);
        await expectCleanupOutcome(clearing, failure);
        expect(clearStorage).toHaveBeenCalledTimes(3);
        expect(clearRuntime).toHaveBeenCalledTimes(1);
        expect(logged).toHaveBeenCalledWith(
          "[WalletMutation] Wallet clear step failed:",
          failure,
        );
        await expect(coordinator.clear(clearStorage)).resolves.toBeUndefined();
      } finally {
        logged.mockRestore();
      }
    },
  );

  it.each(["epoch", "storage", "runtime", "lock"])(
    "preserves a %s failure and cleanup order",
    async (source) => {
      jest.spyOn(console, "error").mockImplementation(() => undefined);
      const order: string[] = [];
      const failure: unknown = { code: "cleanup_failed", message: "cleanup failed" };
      const rejectStep = jest
        .fn(() => Promise.resolve())
        .mockRejectedValue(failure);
      if (source === "epoch") {
        jest
          .spyOn(walletEpoch, "advanceWalletEpoch")
          .mockImplementationOnce(() => {
            throw failure;
          });
      }
      if (source === "lock") {
        jest
          .spyOn(walletEpoch, "withWalletMutationLock")
          .mockRejectedValueOnce(failure);
      }
      let sweeps = 0;
      const clearing = new NativeWalletMutationCoordinator().clear(
        () => {
          order.push(`storage-${++sweeps}`);
          return source === "storage" ? rejectStep() : undefined;
        },
        () => {
          order.push("runtime");
          return source === "runtime" ? rejectStep() : undefined;
        },
      );
      expect(order).toEqual(["storage-1"]);
      await expectCleanupOutcome(clearing, failure);
      expect(order).toEqual(
        source === "lock"
          ? ["storage-1"]
          : ["storage-1", "storage-2", "runtime", "storage-3"],
      );
    },
  );

  it("sweeps state recreated by a restore that was already in flight during wipe", async () => {
    const coordinator = new NativeWalletMutationCoordinator();
    const walletState = new Set<string>();
    let releaseRestore: () => void = () => {
      throw new Error("Missing test resolver");
    };
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

    const clear = coordinator.clear(() => {
      walletState.clear();
    });
    releaseRestore();
    await Promise.all([restore, clear]);

    expect(walletState).toEqual(new Set());
  });

  it("drops restores that arrive after a wipe starts", async () => {
    const coordinator = new NativeWalletMutationCoordinator();
    let releaseClear: () => void = () => {
      throw new Error("Missing test resolver");
    };
    const clearBlocked = new Promise<void>((resolve) => {
      releaseClear = resolve;
    });
    let restoreRan = false;

    const clear = coordinator.clear(async () => clearBlocked);
    await coordinator.enqueueRestore(() => {
      restoreRan = true;
      return Promise.resolve();
    });
    releaseClear();
    await clear;

    expect(restoreRan).toBe(false);
  });

  it("keeps restores blocked through runtime cleanup and the final sweep", async () => {
    const coordinator = new NativeWalletMutationCoordinator();
    const walletState = new Set<string>(["wallet"]);
    let releaseRuntimeClear: () => void = () => {
      throw new Error("Missing test resolver");
    };
    const runtimeClearBlocked = new Promise<void>((resolve) => {
      releaseRuntimeClear = resolve;
    });
    let runtimeClearStarted: () => void = () => {
      throw new Error("Missing test resolver");
    };
    const runtimeClearStart = new Promise<void>((resolve) => {
      runtimeClearStarted = resolve;
    });
    let restoreRan = false;

    const clear = coordinator.clear(
      () => {
        walletState.clear();
      },
      async () => {
        runtimeClearStarted();
        await runtimeClearBlocked;
        // Model a storage reaction produced while runtime state is clearing.
        walletState.add("runtime-reaction");
      },
    );
    await runtimeClearStart;

    await coordinator.enqueueRestore(() => {
      restoreRan = true;
      walletState.add("ghost-account");
      return Promise.resolve();
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
    let releaseRotation: () => void = () => {
      throw new Error("Missing test resolver");
    };
    let rotationStarted: () => void = () => {
      throw new Error("Missing test resolver");
    };
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

    const clear = coordinator.clear(() => {
      walletState.clear();
    });
    releaseRotation();
    await Promise.all([rotation, clear]);

    expect(walletState).toEqual(new Set());
    expect(responses).toEqual(["wallet-cleared"]);
  });

  it("serializes timeout compensation behind the original PIN rotation", async () => {
    const coordinator = new NativeWalletMutationCoordinator();
    const order: string[] = [];
    let releaseOriginal: () => void = () => {
      throw new Error("Missing test resolver");
    };
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
      () => {
        order.push("compensation");
        return Promise.resolve();
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
    let releaseEncryption: () => void = () => {
      throw new Error("Missing test resolver");
    };
    let encryptionStarted: () => void = () => {
      throw new Error("Missing test resolver");
    };
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
    const clear = coordinator.clear(() => {
      walletState.clear();
    });
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

    const clear = clearingTab.clear(() => {
      walletState.clear();
    });
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
      clear: () => {
        values.clear();
      },
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
        () => {
          laterMutationRan = true;
          return Promise.resolve();
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
