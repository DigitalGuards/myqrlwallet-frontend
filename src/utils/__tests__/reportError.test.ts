import log from "../log";
import { reportError } from "../reportError";
import { foreignErrorCases } from "./errorFixtures";

jest.mock("../log", () => ({ __esModule: true, default: jest.fn() }));

it("keeps the diagnostic context and caught error message", () => {
  reportError("Transfer failed:", new Error("RPC unavailable"));
  expect(log).toHaveBeenLastCalledWith("Transfer failed: RPC unavailable");
});

it.each(foreignErrorCases)("logs the original message of $name", ({ create, message }) => {
  reportError("Transfer failed:", create());
  expect(log).toHaveBeenLastCalledWith(`Transfer failed: ${message}`);
});

it("handles thrown objects and circular values through the existing logger", () => {
  reportError("Transfer failed:", { reason: "RPC unavailable" });
  expect(log).toHaveBeenLastCalledWith(
    'Transfer failed: {"reason":"RPC unavailable"}',
  );
  const value: Record<string, unknown> = {};
  value["self"] = value;
  reportError("Transfer failed:", value);
  expect(log).toHaveBeenLastCalledWith("Transfer failed: [object]");
});
