import type { Primitive } from "type-fest";

type MalformedInput<T> =
  | Partial<Record<keyof T, unknown>>
  | readonly unknown[]
  | Primitive;

// This helper exists only so tests can feed invalid data to typed functions.
// Object fixtures retain the target's field names and allow invalid values.
export function malformed<T>(value: MalformedInput<NoInfer<T>>): T {
  return value as T;
}
