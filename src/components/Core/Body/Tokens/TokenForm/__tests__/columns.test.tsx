/** @jest-environment jsdom */

import { fireEvent, render, waitFor } from "@testing-library/react";
import { copyToClipboard } from "@/utils/nativeApp";
import { columns } from "../columns";

jest.mock("@/utils/nativeApp", () => ({
  copyToClipboard: jest.fn(async () => true),
}));

jest.mock("@/stores/store", () => ({
  useStore: jest.fn(),
}));

const ADDRESS =
  "Qd5812F6Cf4a0f645aa620cd57319a0Ed649dd8f5519A9dde7770ae5b0E49e547985f35eB972A2a07041561aa39c65A3991478f9B1e6749e05277dcf58A9A8B72";

function renderAddressCell() {
  const addressColumn = columns.find(
    (column) => (column as { accessorKey?: string }).accessorKey === "address",
  );
  const cellRenderer = addressColumn?.cell;
  if (typeof cellRenderer !== "function") {
    throw new Error("Token address column must provide a cell renderer");
  }

  return render(
    <>{cellRenderer({ row: { getValue: () => ADDRESS } } as never)}</>,
  );
}

describe("token address column", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("uses the standard fingerprint with accessible full reveal and raw copy", async () => {
    const view = renderAddressCell();

    expect(view.getByText("Qd5812F6C...e547985f...8A9A8B72")).toBeTruthy();

    fireEvent.click(view.getByRole("button", { name: "Show full" }));
    expect(
      view
        .getByLabelText(`QRL address ${ADDRESS}`)
        .textContent?.replace(/ /g, ""),
    ).toBe(ADDRESS);

    fireEvent.click(view.getByRole("button", { name: "Copy address" }));
    await waitFor(() => expect(copyToClipboard).toHaveBeenCalledWith(ADDRESS));
  });
});
