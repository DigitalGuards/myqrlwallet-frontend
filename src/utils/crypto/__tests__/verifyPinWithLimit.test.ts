/** @jest-environment jsdom */
import {
  PinVerificationError,
  verifyPinWithLimit,
} from "../verifyPinWithLimit";
import {
  checkLockout,
  getRemainingAttempts,
  recordFailedAttempt,
} from "../pinAttemptTracker";

const wrongPin = () =>
  Object.assign(new Error("Incorrect PIN"), { code: "INCORRECT_PIN" });

beforeEach(() => {
  localStorage.clear();
  jest.spyOn(Date, "now").mockReturnValue(1000000);
});
afterEach(() => jest.restoreAllMocks());

it("counts wrong PINs, locks on the fifth, and refuses decryption until expiry", async () => {
  const decrypt = jest.fn(async () => {
    throw wrongPin();
  });
  for (let attempt = 1; attempt <= 5; attempt++) {
    await expect(verifyPinWithLimit(decrypt)).rejects.toMatchObject({
      attemptsLeft: 5 - attempt,
      isLocked: attempt === 5,
      remainingMs: attempt === 5 ? 900000 : 0,
    });
  }
  expect(decrypt).toHaveBeenCalledTimes(5);
  jest.spyOn(Date, "now").mockReturnValue(1060000);
  await expect(verifyPinWithLimit(decrypt)).rejects.toMatchObject({
    isLocked: true,
    remainingMs: 840000,
    message: "Too many failed attempts. Please wait 14 minutes.",
  });
  expect(decrypt).toHaveBeenCalledTimes(5);
  jest.spyOn(Date, "now").mockReturnValue(1900000);
  await expect(verifyPinWithLimit(decrypt)).rejects.toMatchObject({
    attemptsLeft: 4,
  });
  expect(decrypt).toHaveBeenCalledTimes(6);
});

it("recognizes the direct PIN authentication error", async () => {
  const error = Object.assign(new Error("Authentication failed"), {
    name: "PinDecryptionError",
    incorrectPin: true,
  });
  await expect(
    verifyPinWithLimit(() => Promise.reject(error)),
  ).rejects.toBeInstanceOf(PinVerificationError);
  expect(getRemainingAttempts()).toBe(4);
});

it.each([
  new Error("RPC unavailable"),
  new Error("Signing failed"),
  new Error("Incorrect PIN"),
  Object.assign(new Error("Missing device credential"), {
    code: "DEVICE_CREDENTIAL_UNAVAILABLE",
  }),
  Object.assign(new Error("Old envelope"), { code: "OUTDATED_FORMAT" }),
  Object.assign(new Error("Corrupt data"), {
    name: "PinDecryptionError",
    incorrectPin: false,
  }),
  { code: "INCORRECT_PIN" },
])(
  "propagates other failures without consuming an attempt: %s",
  async (error) => {
    recordFailedAttempt();
    await expect(verifyPinWithLimit(() => Promise.reject(error))).rejects.toBe(
      error,
    );
    expect(getRemainingAttempts()).toBe(4);
    expect(checkLockout().isLocked).toBe(false);
  },
);

it("returns the exact decrypted value and resets failures on success", async () => {
  for (let index = 0; index < 4; index++) recordFailedAttempt();
  const seed = { mnemonic: "fixture", hexSeed: "00" };
  expect(await verifyPinWithLimit(async () => seed)).toBe(seed);
  expect(getRemainingAttempts()).toBe(5);
  expect(checkLockout().isLocked).toBe(false);
});

it("preserves the lockout deadline when an in-flight wrong PIN settles later", async () => {
  let fail = (_error: Error) => {};
  const pending = verifyPinWithLimit(
    () =>
      new Promise<never>((_resolve, reject) => {
        fail = reject;
      }),
  );
  for (let index = 0; index < 5; index++) recordFailedAttempt();
  jest.spyOn(Date, "now").mockReturnValue(1060000);
  fail(wrongPin());
  await expect(pending).rejects.toMatchObject({ remainingMs: 840000 });
  expect(checkLockout().remainingMs).toBe(840000);
});

it("refuses concurrent submissions before decrypting and releases the guard after failure", async () => {
  let fail = (_error: Error) => {};
  const pending = verifyPinWithLimit(
    () =>
      new Promise<never>((_resolve, reject) => {
        fail = reject;
      }),
  );
  const decrypt = jest.fn(async () => "seed");
  const busy = verifyPinWithLimit(decrypt);
  await expect(busy).rejects.toBeInstanceOf(PinVerificationError);
  await expect(busy).rejects.toMatchObject({
    isLocked: false,
    attemptsLeft: 5,
    message: "Another PIN check is still running. Please try again.",
  });
  expect(decrypt).not.toHaveBeenCalled();
  expect(getRemainingAttempts()).toBe(5);
  fail(wrongPin());
  await expect(pending).rejects.toMatchObject({ attemptsLeft: 4 });
  await expect(verifyPinWithLimit(decrypt)).resolves.toBe("seed");
});

it("returns a correct PIN's result when the tracker cannot write", async () => {
  recordFailedAttempt();
  const setItem = jest
    .spyOn(Storage.prototype, "setItem")
    .mockImplementation(() => {
      throw new DOMException("quota exceeded", "QuotaExceededError");
    });
  try {
    await expect(verifyPinWithLimit(async () => "seed")).resolves.toBe("seed");
  } finally {
    setItem.mockRestore();
  }
});

it("preserves a lockout that starts while a correct PIN is being decrypted", async () => {
  let finish = (_seed: string) => {};
  const pending = verifyPinWithLimit(
    () =>
      new Promise<string>((resolve) => {
        finish = resolve;
      }),
  );
  for (let index = 0; index < 5; index++) recordFailedAttempt();
  finish("seed");
  await expect(pending).rejects.toMatchObject({ isLocked: true });
  expect(checkLockout().isLocked).toBe(true);
});
