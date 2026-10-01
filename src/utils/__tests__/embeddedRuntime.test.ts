import { describe, expect, it } from "@jest/globals";
import {
  EMBEDDED_FLAG_SCRIPT,
  EMBEDDED_GLOBAL_FLAG,
  isEmbeddedRuntime,
} from "@/utils/embeddedRuntime";

describe("embedded runtime flag", () => {
  it("is false in a plain web document", () => {
    expect(isEmbeddedRuntime({})).toBe(false);
  });

  it("is true only for the exact boolean the build writes", () => {
    expect(isEmbeddedRuntime({ [EMBEDDED_GLOBAL_FLAG]: true })).toBe(true);
    for (const value of ["true", 1, {}, null, undefined]) {
      expect(isEmbeddedRuntime({ [EMBEDDED_GLOBAL_FLAG]: value })).toBe(false);
    }
  });

  it("is false when there is no window at all", () => {
    expect(typeof window).toBe("undefined");
    expect(isEmbeddedRuntime()).toBe(false);
  });

  it("injects a script that sets the global this module reads", () => {
    const scope: Record<string, unknown> = {};
    new Function("window", EMBEDDED_FLAG_SCRIPT)(scope);
    expect(isEmbeddedRuntime(scope)).toBe(true);
  });
});
