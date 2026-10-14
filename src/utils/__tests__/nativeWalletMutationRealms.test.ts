/** @jest-environment jsdom */

import { toError } from "../guards";
import { NativeWalletMutationCoordinator } from "../nativeWalletMutation";
import * as walletEpoch from "../walletEpoch";

const message = "The database connection is closing.";
const name = "InvalidStateError";

function foreignDOMException(): DOMException {
  const iframe = document.createElement("iframe");
  document.body.append(iframe);
  const realm = iframe.contentDocument?.defaultView;
  if (!realm) throw new Error("Missing iframe window");
  const failure = new realm.DOMException(message, name);
  expect(failure).not.toBeInstanceOf(DOMException);
  expect(failure).not.toBeInstanceOf(Error);
  return failure;
}

afterEach(() => {
  jest.restoreAllMocks();
  document.body.replaceChildren();
});

it("normalizes a foreign-window DOMException to a local Error", () => {
  const failure = foreignDOMException();
  const normalized = toError(failure);
  expect(normalized).toBeInstanceOf(Error);
  expect(normalized.name).toBe(name);
  expect(normalized.message).toBe(message);
  expect(failure.name).toBe(name);
  expect(failure.message).toBe(message);
});

it.each(["epoch", "storage-1", "storage-2", "runtime", "storage-3", "lock"])(
  "rethrows the original foreign-window DOMException from %s",
  async (source) => {
    jest.spyOn(console, "error").mockImplementation(() => undefined);
    const failure = foreignDOMException();
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
    const clearStorage = jest.fn(() => {
      sweeps += 1;
      if (source === "storage-" + sweeps.toString()) throw failure;
    });
    const clearRuntime = jest.fn(() => {
      if (source === "runtime") throw failure;
    });
    const coordinator = new NativeWalletMutationCoordinator();
    const clearing = coordinator.clear(clearStorage, clearRuntime);

    await expect(clearing).rejects.toBe(failure);
    await expect(clearing).rejects.toMatchObject({ name, message });
    expect(clearStorage).toHaveBeenCalledTimes(source === "lock" ? 1 : 3);
    expect(clearRuntime).toHaveBeenCalledTimes(source === "lock" ? 0 : 1);
    await expect(coordinator.clear(() => undefined)).resolves.toBeUndefined();
  },
);
