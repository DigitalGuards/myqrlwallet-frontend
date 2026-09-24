/** @jest-environment jsdom */

import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { copyToClipboard } from "@/utils/nativeApp";
import { AddressDisclosure } from "../AddressDisclosure";

jest.mock("@/utils/nativeApp", () => ({
  copyToClipboard: jest.fn(async () => true),
}));

const ADDRESS =
  "Qd5812F6Cf4a0f645aa620cd57319a0Ed649dd8f5519A9dde7770ae5b0E49e547985f35eB972A2a07041561aa39c65A3991478f9B1e6749e05277dcf58A9A8B72";

afterEach(() => {
  cleanup();
  jest.clearAllMocks();
});

describe("AddressDisclosure", () => {
  it("shows the three-part fingerprint and keeps the exact address for assistive technology", () => {
    const view = render(<AddressDisclosure address={ADDRESS} />);

    expect(view.getByText("Qd5812F6C...e547985f...8A9A8B72")).toBeTruthy();
    expect(view.getByTitle(ADDRESS)).toBeTruthy();
    expect(view.getAllByText(ADDRESS).length).toBeGreaterThan(0);
    expect(view.queryByTestId("address-disclosure-full")).toBeNull();
  });

  it("reveals the complete address in groups of five and collapses again", () => {
    const view = render(<AddressDisclosure address={ADDRESS} />);

    const reveal = view.getByRole("button", { name: "Show full address" });
    expect(reveal.getAttribute("aria-expanded")).toBe("false");

    fireEvent.click(reveal);

    const full = view.getByTestId("address-disclosure-full");
    const hide = view.getByRole("button", { name: "Hide full address" });
    expect(hide.getAttribute("aria-expanded")).toBe("true");
    expect(hide.getAttribute("aria-controls")).toBe(full.getAttribute("id"));

    const visible = full.querySelector('[aria-hidden="true"]');
    const tokens = visible?.textContent?.split(" ") ?? [];
    expect(tokens[0]).toBe("Q");
    expect(tokens[1]).toBe("d5812");
    expect(tokens.slice(1).every((group) => group.length <= 5)).toBe(true);
    expect(tokens.join("")).toBe(ADDRESS);

    fireEvent.click(hide);
    expect(view.queryByTestId("address-disclosure-full")).toBeNull();
  });

  it("copies the exact unmodified address and confirms it", async () => {
    const view = render(<AddressDisclosure address={ADDRESS} />);

    fireEvent.click(view.getByRole("button", { name: "Copy address" }));

    await waitFor(() => expect(copyToClipboard).toHaveBeenCalledWith(ADDRESS));
    await waitFor(() =>
      expect(view.getByRole("button", { name: "Address copied" })).toBeTruthy(),
    );
  });
});
