import { nativeMaxReserve } from "../nativeMaxReserve";

it("reserves fees and verifies the actual Max value", async () => {
  const estimate = jest.fn(async () => "0.0000252");
  expect(await nativeMaxReserve("1", estimate)).toBe("0.0000252");
  expect(estimate.mock.calls).toEqual([
    ["0.000000000000000001"],
    ["0.9999748"],
  ]);
});

it("retains a conservative reserve when the reduced value consumes less gas", async () => {
  const estimate = jest
    .fn()
    .mockResolvedValueOnce("0.1")
    .mockResolvedValueOnce("0.05");
  expect(await nativeMaxReserve("1", estimate)).toBe("0.1");
});

it("re-estimates when the reduced value consumes more gas", async () => {
  const estimate = jest
    .fn()
    .mockResolvedValueOnce("0.1")
    .mockResolvedValue("0.2");
  expect(await nativeMaxReserve("1", estimate)).toBe("0.2");
  expect(estimate.mock.calls).toEqual([
    ["0.000000000000000001"],
    ["0.9"],
    ["0.8"],
  ]);
});

it("bounds unstable estimates", async () => {
  const estimate = jest
    .fn()
    .mockResolvedValueOnce("0.1")
    .mockResolvedValueOnce("0.2")
    .mockResolvedValue("0.3");
  await expect(nativeMaxReserve("1", estimate)).rejects.toThrow(
    "quote changed",
  );
  expect(estimate).toHaveBeenCalledTimes(3);
});

it.each(["-1", "1", "2", "invalid"])(
  "rejects an unusable fee %s",
  async (fee) => {
    await expect(nativeMaxReserve("1", async () => fee)).rejects.toThrow();
  },
);

it("preserves exact amounts and genuine zero fees", async () => {
  const estimate = jest.fn(async () => "0");
  expect(
    await nativeMaxReserve("9007199254740993.123456789012345678", estimate),
  ).toBe("0.0");
  expect(estimate).toHaveBeenCalledWith("9007199254740993.123456789012345678");
});

it("propagates estimation failure", async () => {
  await expect(
    nativeMaxReserve("1", async () => {
      throw new Error("offline");
    }),
  ).rejects.toThrow("offline");
});
