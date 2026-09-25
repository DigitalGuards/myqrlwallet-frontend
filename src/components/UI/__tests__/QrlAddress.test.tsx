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
  it("uses a two-part short label without changing the raw address or full view", async () => {
    const view = render(
      <QrlAddress address={ADDRESS} compactFormat="short" copyable />,
    );
    expect(view.getByText("Qd5812F6C...8A9A8B72")).toBeTruthy();
    expect(view.getByLabelText(`QRL address ${ADDRESS}`)).toBeTruthy();
    fireEvent.click(view.getByRole("button", { name: "Copy address" }));
    await waitFor(() => expect(copyToClipboard).toHaveBeenCalledWith(ADDRESS));

    view.rerender(
      <QrlAddress address={ADDRESS} compactFormat="short" mode="full" />,
    );
    expect(
      view
        .getByLabelText(`QRL address ${ADDRESS}`)
        .textContent?.replace(/ /g, ""),
    ).toBe(ADDRESS);
  });
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
    // Columns follow the container width, never the viewport, so a
    // revealed address in a narrow card cannot overlap itself.
    expect(view.getByLabelText(`QRL address ${ADDRESS}`).className).toContain(
      "grid-cols-[repeat(auto-fill,minmax(min(16ch,100%),1fr))]",
    );
    expect(
      view.getByLabelText(`QRL address ${ADDRESS}`).className,
    ).not.toMatch(/(sm|md):grid-cols-/);
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

  it("opens an external address view while keeping the fingerprint compact", () => {
    const onShowFull = jest.fn();
    const onParentClick = jest.fn();
    const view = render(
      <div onClick={onParentClick}>
        <QrlAddress address={ADDRESS} revealable onShowFull={onShowFull} />
      </div>,
    );

    const showFull = view.getByRole("button", { name: "Show full" });
    expect(showFull.hasAttribute("aria-expanded")).toBe(false);
    fireEvent.click(showFull);

    expect(onShowFull).toHaveBeenCalledTimes(1);
    expect(onParentClick).not.toHaveBeenCalled();
    expect(view.getByText("Qd5812F6C...e547985f...8A9A8B72")).toBeTruthy();
    expect(view.queryByRole("button", { name: "Show less" })).toBeNull();
    expect(
      view.container.querySelector('[data-address-mode="full"]'),
    ).toBeNull();
  });

  it("keeps copying separate from the external address action", async () => {
    const onShowFull = jest.fn();
    const view = render(
      <QrlAddress address={ADDRESS} onShowFull={onShowFull} copyable />,
    );

    fireEvent.click(view.getByRole("button", { name: "Copy address" }));

    await waitFor(() => expect(copyToClipboard).toHaveBeenCalledWith(ADDRESS));
    expect(onShowFull).not.toHaveBeenCalled();
  });

  it("links the address out while keeping copy as a separate control", async () => {
    const view = render(
      <QrlAddress
        address={ADDRESS}
        href={`https://explorer.invalid/address/${ADDRESS}`}
        linkLabel="View contract on the explorer"
        copyable
        copyLabel="Copy contract address"
      />,
    );

    const link = view.getByRole("link", {
      name: (name: string) =>
        name.includes(ADDRESS) &&
        name.includes("View contract on the explorer"),
    });
    expect(link.getAttribute("href")).toBe(
      `https://explorer.invalid/address/${ADDRESS}`,
    );
    expect(link.getAttribute("rel")).toBe("noopener noreferrer");
    expect(link.getAttribute("title")).toBe(ADDRESS);
    expect(link.className).toContain("min-w-0");

    const copy = view.getByRole("button", { name: "Copy contract address" });
    expect(link.contains(copy)).toBe(false);

    fireEvent.click(copy);
    await waitFor(() => expect(copyToClipboard).toHaveBeenCalledWith(ADDRESS));
  });

  it("names an unlabelled explorer link after the address it opens", () => {
    const view = render(
      <QrlAddress
        address={ADDRESS}
        href={`https://explorer.invalid/address/${ADDRESS}`}
      />,
    );

    const link = view.getByRole("link", {
      name: (name: string) =>
        name.includes(ADDRESS) && name.includes("opens in a new tab"),
    });
    expect(link.getAttribute("aria-label")).toBeNull();
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
