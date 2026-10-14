/** @jest-environment jsdom */

import { cleanup, fireEvent, render } from "@testing-library/react";
import type { ReactNode } from "react";
import { useMemo } from "react";
import { useForm } from "react-hook-form";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "../Form";

jest.mock("@/utils", () =>
  jest.requireActual<typeof import("@/utils/cn")>("@/utils/cn"),
);

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

function FormHarness({ children }: { children: ReactNode }) {
  const form = useForm<{ address: string }>({
    defaultValues: { address: "Original address" },
  });
  return <Form {...form}>{children}</Form>;
}

function AddressField({ message }: { message?: string }) {
  const errors = useMemo(
    () =>
      message === undefined
        ? undefined
        : { address: { type: "validate", message } },
    [message],
  );
  const form = useForm<{ address: string }>({
    defaultValues: { address: "Original address" },
    errors,
  });
  return (
    <Form {...form}>
      <FormField
        control={form.control}
        name="address"
        render={({ field }) => (
          <FormItem>
            <FormLabel>Recipient</FormLabel>
            <FormControl>
              <input {...field} />
            </FormControl>
            <FormDescription>Enter the full address</FormDescription>
            <FormMessage />
          </FormItem>
        )}
      />
    </Form>
  );
}

it("keeps field values, labels and description IDs connected", () => {
  const view = render(<AddressField />);
  const input = view.getByRole("textbox", { name: "Recipient" });
  const description = view.getByText("Enter the full address");

  expect(view.getByDisplayValue("Original address")).toBe(input);
  expect(input.getAttribute("aria-describedby")).toBe(description.id);
  expect(input.getAttribute("aria-invalid")).toBe("false");
  expect(view.container.querySelectorAll("p")).toHaveLength(1);
  fireEvent.change(input, { target: { value: "Updated address" } });
  expect(view.getByDisplayValue("Updated address")).toBe(input);
});

it("renders validation messages and associates them with the field", () => {
  const view = render(<AddressField message="Invalid recipient" />);
  const input = view.getByRole("textbox", { name: "Recipient" });
  const description = view.getByText("Enter the full address");
  const message = view.getByText("Invalid recipient");

  expect(input.getAttribute("aria-invalid")).toBe("true");
  expect(input.getAttribute("aria-describedby")).toBe(
    `${description.id} ${message.id}`,
  );
  expect(view.getByText("Recipient").className).toContain("text-destructive");
});

it("rejects a control outside FormField", () => {
  jest.spyOn(console, "error").mockImplementation(() => undefined);
  expect(() => {
    render(
      <FormHarness>
        <FormItem>
          <FormControl>
            <input />
          </FormControl>
        </FormItem>
      </FormHarness>,
    );
  }).toThrow("useFormField should be used within <FormField>");
});

it("rejects a field control outside FormItem", () => {
  jest.spyOn(console, "error").mockImplementation(() => undefined);
  expect(() => {
    render(
      <FormHarness>
        <FormField<{ address: string }>
          name="address"
          render={({ field }) => (
            <FormControl>
              <input {...field} />
            </FormControl>
          )}
        />
      </FormHarness>,
    );
  }).toThrow("useFormField should be used within <FormItem>");
});
