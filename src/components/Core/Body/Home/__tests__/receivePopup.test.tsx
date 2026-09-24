/** @jest-environment jsdom */

import { cleanup, fireEvent, render } from "@testing-library/react";
import { ReceivePopup } from "../ReceivePopup";

const ADDRESS =
  "Qd5812F6Cf4a0f645aa620cd57319a0Ed649dd8f5519A9dde7770ae5b0E49e547985f35eB972A2a07041561aa39c65A3991478f9B1e6749e05277dcf58A9A8B72";

jest.mock("@/utils/nativeApp", () => ({
  copyToClipboard: jest.fn(async () => true),
}));
jest.mock("mobx-react-lite", () => ({
  observer: (component: unknown) => component,
}));
jest.mock("@/utils", () => ({
  cn: (...values: unknown[]) => values.filter(Boolean).join(" "),
}));

afterEach(() => {
  cleanup();
  jest.clearAllMocks();
});

const renderPopup = () =>
  render(
    <ReceivePopup accountAddress={ADDRESS} isOpen onClose={jest.fn()} />,
  );

it("encodes the plain address in a QR on a light quiet-zone card", () => {
  const view = renderPopup();

  const qr = view.container.querySelector("svg");
  expect(qr).toBeTruthy();
  expect(qr?.parentElement?.className).toContain("bg-white");
  expect(qr?.parentElement?.className).toContain("rounded-lg");
});

it("keeps the address compact until the reveal toggle is used", () => {
  const view = renderPopup();

  expect(view.getByText("Qd5812F6C...e547985f...8A9A8B72")).toBeTruthy();
  expect(view.queryByTestId("address-disclosure-full")).toBeNull();

  fireEvent.click(view.getByRole("button", { name: "Show full address" }));

  const full = view.getByTestId("address-disclosure-full");
  const visible = full.querySelector('[aria-hidden="true"]');
  expect(visible?.textContent?.split(" ").join("")).toBe(ADDRESS);
});
