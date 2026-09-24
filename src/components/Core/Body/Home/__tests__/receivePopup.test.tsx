/** @jest-environment jsdom */

import { cleanup, fireEvent, render } from "@testing-library/react";
import { QRCodeSVG } from "qrcode.react";
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

const viewBoxModules = (svg: Element | null): number =>
  Number(svg?.getAttribute("viewBox")?.split(" ")[2] ?? 0);

it("encodes the plain address in a QR on a light quiet-zone card", () => {
  const view = renderPopup();

  const qr = view.container.querySelector("svg");
  expect(qr).toBeTruthy();
  expect(qr?.parentElement?.className).toContain("bg-white");
  expect(qr?.parentElement?.className).toContain("rounded-lg");
});

it("draws at least the four-module quiet zone the QR spec requires", () => {
  const view = renderPopup();
  const reference = render(
    <QRCodeSVG value={ADDRESS} size={200} level="L" marginSize={0} />,
  );

  const symbolModules = viewBoxModules(
    reference.container.querySelector("svg"),
  );
  const renderedModules = viewBoxModules(view.container.querySelector("svg"));

  expect(symbolModules).toBeGreaterThan(0);
  expect(renderedModules - symbolModules).toBeGreaterThanOrEqual(8);
});

it("keeps the address compact until the reveal toggle is used", () => {
  const view = renderPopup();

  expect(view.getByText("Qd5812F6C...e547985f...8A9A8B72")).toBeTruthy();
  expect(view.queryByTestId("address-disclosure-full")).toBeNull();

  fireEvent.click(view.getByRole("button", { name: "Show full address" }));

  expect(view.getByTestId("address-disclosure-full")).toBeTruthy();
  expect(
    view.getByTestId("address-disclosure-full-text").textContent,
  ).toBe(ADDRESS);
});
