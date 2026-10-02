/**
 * @jest-environment jsdom
 *
 * The boot module runs at module-evaluation time inside a bundle with no code
 * splitting, so anything it lets escape aborts the whole document.
 */
import { describe, expect, it, jest } from "@jest/globals";

// The native bridge exists only in the embedded build, which the app ships.
jest.mock("@/utils/embeddedRuntime", () => ({
  ...jest.requireActual<typeof import("@/utils/embeddedRuntime")>(
    "@/utils/embeddedRuntime",
  ),
  IS_EMBEDDED_BUILD: true,
  HAS_NATIVE_BRIDGE: true,
}));

const mockRunEmbeddedMigration = jest.fn(() => true);

jest.mock("@/utils/embeddedMigration", () => ({
  runEmbeddedMigration: () => mockRunEmbeddedMigration(),
}));

describe("embedded migration boot", () => {
  it("swallows a throw so the rest of the bundle still evaluates", async () => {
    mockRunEmbeddedMigration.mockImplementation(() => {
      throw new Error("the bridge is gone");
    });
    const logged = jest.spyOn(console, "error").mockImplementation(() => {});

    await expect(import("@/utils/embeddedMigrationBoot")).resolves.toBeDefined();

    expect(mockRunEmbeddedMigration).toHaveBeenCalledTimes(1);
    expect(logged).toHaveBeenCalled();
    logged.mockRestore();
  });
});
