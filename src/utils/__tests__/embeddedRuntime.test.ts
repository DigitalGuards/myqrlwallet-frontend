import { Script } from "node:vm";
import { describe, expect, it } from "@jest/globals";
import {
  EMBEDDED_FLAG_SCRIPT,
  EMBEDDED_GLOBAL_FLAG,
  isEmbeddedRuntime,
} from "@/utils/embeddedRuntime";

describe("embedded runtime flag", () => {
  it("is false in a plain web document", () => {
    expect(isEmbeddedRuntime({})).toBe(false);
    for (const scope of ["true", 1, false, [], null]) {
      expect(isEmbeddedRuntime(scope)).toBe(false);
    }
  });

  it("is true only for the exact boolean the build writes", () => {
    expect(isEmbeddedRuntime({ [EMBEDDED_GLOBAL_FLAG]: true })).toBe(true);
    for (const value of ["true", 1, {}, null, undefined]) {
      expect(isEmbeddedRuntime({ [EMBEDDED_GLOBAL_FLAG]: value })).toBe(false);
    }
  });

  it.each([
    { name: "object", container: () => ({}) },
    { name: "array", container: () => [] },
    { name: "function", container: () => () => undefined },
    { name: "boxed string", container: () => new String("") },
  ])("preserves runtime flags on a $name", ({ container }) => {
    for (const flag of [true, false, "true", 1, null, undefined]) {
      const scope: unknown = Object.assign(container(), { [EMBEDDED_GLOBAL_FLAG]: flag });
      expect(isEmbeddedRuntime(scope)).toBe(flag === true);
    }
  });

  it("is false when there is no window at all", () => {
    expect(typeof window).toBe("undefined");
    expect(isEmbeddedRuntime()).toBe(false);
  });

  it("injects a script that sets the global this module reads", () => {
    const scope: Record<string, unknown> = {};
    new Script(EMBEDDED_FLAG_SCRIPT).runInNewContext({ window: scope });
    expect(isEmbeddedRuntime(scope)).toBe(true);
  });
});
