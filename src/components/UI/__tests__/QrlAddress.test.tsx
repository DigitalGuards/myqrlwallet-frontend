/** @jest-environment jsdom */

import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { copyToClipboard } from "@/utils/nativeApp";
import { QrlAddress } from "../QrlAddress";

jest.mock("@/utils/nativeApp", () => ({
  copyToClipboard: jest.fn(async () => true),
}));

const ADDRESS =
  "Qd5812F6Cf4a0f645aa620cd57319a0Ed649dd8f5519A9dde7770ae5b0E49e547985f35eB972A2a07041561aa39c65A3991478f9B1e6749e05277dcf58A9A8B72";

afterEach(() => {
  cleanup();
  jest.clearAllMocks();
});

describe("QrlAddress", () => {
  it("reveals the complete grouped address through a tap and keyboard accessible control", () => {
    const view = render(<QrlAddress address={ADDRESS} revealable />);

    const reveal = view.getByRole("button", { name: "Show full" });
    expect(reveal.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(reveal);

    expect(view.getByText("Show less").getAttribute("aria-expanded")).toBe(
      "true",
    );
    expect(
      view
        .getByLabelText(`QRL address ${ADDRESS}`)
        .textContent?.replace(/ /g, ""),
    ).toBe(ADDRESS);
    expect(
      view.getByLabelText(`QRL address ${ADDRESS}`).className,
    ).toContain("grid-cols-2");
    expect(
      view.getByLabelText(`QRL address ${ADDRESS}`).className,
    ).toContain("md:grid-cols-8");
    expect(
      view.container.querySelector('[data-address-revealed="true"]'),
    ).toBeTruthy();

    fireEvent.click(view.getByRole("button", { name: "Show less" }));
    expect(
      view.container.querySelector('[data-address-revealed="true"]'),
    ).toBeNull();
  });

  it("copies the exact unformatted address", async () => {
    const view = render(<QrlAddress address={ADDRESS} copyable />);

    fireEvent.click(view.getByRole("button", { name: "Copy address" }));

    await waitFor(() => expect(copyToClipboard).toHaveBeenCalledWith(ADDRESS));
    await waitFor(() =>
      expect(view.getByRole("button", { name: "Address copied" })).toBeTruthy(),
    );
  });

  it("uses wrapping full-address styles without the obsolete fit-to-one-line class", () => {
    const view = render(<QrlAddress address={ADDRESS} mode="full" />);
    const address = view.getByLabelText(`QRL address ${ADDRESS}`);

    expect(address.className).toContain("whitespace-normal");
    expect(address.className).toContain("break-words");
    expect(address.className).not.toContain("whitespace-nowrap");
    expect(view.container.querySelector(".address-fit")).toBeNull();
  });
});
