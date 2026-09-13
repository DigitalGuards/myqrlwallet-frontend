/** @jest-environment jsdom */

import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { copyToClipboard } from "@/utils/nativeApp";
import { ActiveAccountDisplay } from "../AccountCreateImport/ActiveAccountDisplay/ActiveAccountDisplay";

const ADDRESS =
  "Qd5812F6Cf4a0f645aa620cd57319a0Ed649dd8f5519A9dde7770ae5b0E49e547985f35eB972A2a07041561aa39c65A3991478f9B1e6749e05277dcf58A9A8B72";

jest.mock("@/stores/store", () => ({
  useStore: () => ({
    qrlStore: {
      activeAccount: { accountAddress: ADDRESS },
      activeAccountBalance: "123",
      activeAccountBalanceUsd: 0,
      qrlPrice: 0,
      qrlPriceChange24h: 0,
      fetchAccounts: jest.fn(),
    },
  }),
}));
jest.mock("@/utils/nativeApp", () => ({
  copyToClipboard: jest.fn(async () => true),
}));
jest.mock("mobx-react-lite", () => ({
  observer: (component: unknown) => component,
}));
jest.mock("../AccountCreateImport/ActiveAccountDisplay/SlotBalance", () => ({
  SlotBalance: ({ value }: { value: string }) => <span>{value}</span>,
}));

afterEach(() => {
  cleanup();
  jest.clearAllMocks();
});

it("opens Receive through Show full without expanding or copying the wallet address", () => {
  const onShowAddress = jest.fn();
  const view = render(<ActiveAccountDisplay onShowAddress={onShowAddress} />);

  fireEvent.click(view.getByRole("button", { name: "Show full" }));

  expect(onShowAddress).toHaveBeenCalledTimes(1);
  expect(copyToClipboard).not.toHaveBeenCalled();
  expect(view.getByText("Qd5812F6C...e547985f...8A9A8B72")).toBeTruthy();
  expect(view.queryByRole("button", { name: "Show less" })).toBeNull();
  expect(view.container.querySelector('[data-address-mode="full"]')).toBeNull();
});

it("keeps direct address copying separate from Receive", async () => {
  const onShowAddress = jest.fn();
  const view = render(<ActiveAccountDisplay onShowAddress={onShowAddress} />);

  fireEvent.click(view.getByLabelText("QRL address " + ADDRESS));

  await waitFor(() => expect(copyToClipboard).toHaveBeenCalledWith(ADDRESS));
  expect(onShowAddress).not.toHaveBeenCalled();
});
