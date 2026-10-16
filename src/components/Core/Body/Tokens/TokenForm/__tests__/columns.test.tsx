/** @jest-environment jsdom */

import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { flexRender, type ColumnDef } from "@tanstack/react-table";
import type { TokenInterface } from "@/constants";
import { copyToClipboard } from "@/utils/nativeApp";
import { reportError } from "@/utils/reportError";
import { columns } from "../columns";
import { CopyableText, BalanceCell, HideTokenButton } from "../TokenCells";
import { DataTable } from "../data-table";

const mockNavigate = jest.fn<Promise<void> | void, [string]>();
jest.mock("@/utils/reportError", () => ({ reportError: jest.fn() }));

jest.mock("@/utils/nativeApp", () => ({
  copyToClipboard: jest.fn(() => Promise.resolve(true)),
}));

const mockHide = jest.fn<Promise<void>, [string]>();
jest.mock("@/stores/store", () => ({
  useStore: () => ({ tokenStore: { hideToken: mockHide, isRefreshingBalances: false } }),
}));
jest.mock("react-router", () => ({ useNavigate: () => mockNavigate }));
jest.mock("@/router/router", () => ({ ROUTES: { TRANSFER: "/transfer" } }));

const ADDRESS =
  "Qd5812F6Cf4a0f645aa620cd57319a0Ed649dd8f5519A9dde7770ae5b0E49e547985f35eB972A2a07041561aa39c65A3991478f9B1e6749e05277dcf58A9A8B72";

const SECOND_ADDRESS = `Q${"2".repeat(128)}`;
const SHORT_ADDRESS = "Qd5812F6C...8A9A8B72";
const TOKENS: TokenInterface[] = [ADDRESS, SECOND_ADDRESS].map(
  (address, index) => ({
    address,
    name: `Token ${index + 1}`,
    symbol: `TOK${index + 1}`,
    amount: "1",
    decimals: 0,
  }),
);

function renderAddressCells() {
  const addressColumn = columns.find(
    (column) => "accessorKey" in column && column.accessorKey === "address",
  );
  if (!addressColumn || typeof addressColumn.cell !== "function") {
    throw new Error("Token address column must provide a cell renderer");
  }
  const renderCell = addressColumn.cell;
  const onTokenSelected = jest.fn();
  const observedColumn: ColumnDef<TokenInterface> = {
    ...addressColumn,
    cell: (context) =>
      flexRender(renderCell, {
        ...context,
        row: {
          ...context.row,
          toggleSelected: (selected, options) => {
            onTokenSelected(context.row.original.address, selected);
            context.row.toggleSelected(selected, options);
          },
        },
      }),
  };
  const onRowClick = jest.fn();
  const view = render(
    <div onClick={onRowClick}>
      <DataTable columns={[observedColumn]} data={TOKENS} />
    </div>,
  );
  return { ...view, onRowClick, onTokenSelected };
}

beforeEach(() => { jest.clearAllMocks(); });
afterEach(cleanup);

describe("token address column", () => {

  it("uses a start/end address and opens transfer once without expanding or bubbling", async () => {
    const view = renderAddressCells();
    expect(view.getByText(SHORT_ADDRESS)).toBeTruthy();
    expect(view.queryByText("Qd5812F6C...e547985f...8A9A8B72")).toBeNull();

    const showFull = view.getAllByRole("button", { name: "Show full" })[0];
    if (!showFull) throw new Error("Expected the first token address action");
    fireEvent.click(showFull);

    await waitFor(() => { expect(mockNavigate).toHaveBeenCalledTimes(1); });
    expect(mockNavigate).toHaveBeenCalledWith(`/transfer?asset=${ADDRESS}`);
    expect(view.onTokenSelected).toHaveBeenCalledTimes(1);
    expect(view.onTokenSelected).toHaveBeenCalledWith(ADDRESS, true);
    expect(view.onRowClick).not.toHaveBeenCalled();
    expect(view.getByLabelText(`QRL address ${ADDRESS}`).textContent).toBe(
      SHORT_ADDRESS,
    );
    expect(view.queryByRole("button", { name: "Show less" })).toBeNull();
    expect(
      view.container.querySelector('[data-address-mode="full"]'),
    ).toBeNull();
    expect(copyToClipboard).not.toHaveBeenCalled();
  });

  it("preserves the selected token's complete contract address in the transfer destination", async () => {
    const view = renderAddressCells();
    const showFull = view.getAllByRole("button", { name: "Show full" })[1];
    if (!showFull) throw new Error("Expected the second token address action");
    fireEvent.click(showFull);

    await waitFor(() => { expect(mockNavigate).toHaveBeenCalledTimes(1); });
    expect(mockNavigate).toHaveBeenCalledWith(
      `/transfer?asset=${SECOND_ADDRESS}`,
    );
    expect(view.onTokenSelected).toHaveBeenCalledTimes(1);
    expect(view.onTokenSelected).toHaveBeenCalledWith(SECOND_ADDRESS, true);
    expect(view.onRowClick).not.toHaveBeenCalled();
  });

  it("copies the raw address without selecting a token, navigating, or expanding", async () => {
    const view = renderAddressCells();
    const copy = view.getAllByRole("button", { name: "Copy address" })[0];
    if (!copy) throw new Error("Expected the first token copy action");
    fireEvent.click(copy);

    await waitFor(() => { expect(copyToClipboard).toHaveBeenCalledTimes(1); });
    expect(copyToClipboard).toHaveBeenCalledWith(ADDRESS);
    expect(mockNavigate).not.toHaveBeenCalled();
    expect(view.onTokenSelected).not.toHaveBeenCalled();
    expect(view.onRowClick).not.toHaveBeenCalled();
    expect(view.getByLabelText(`QRL address ${ADDRESS}`).textContent).toBe(
      SHORT_ADDRESS,
    );
    expect(
      view.container.querySelector('[data-address-mode="full"]'),
    ).toBeNull();
  });
});

it("clears selection so the same token can be opened again", async () => {
  const view = renderAddressCells();
  const [open] = view.getAllByRole("button", { name: "Show full" });
  if (!open) throw new Error("Missing token action");
  fireEvent.click(open);
  await waitFor(() => { expect(mockNavigate).toHaveBeenCalledTimes(1); });
  fireEvent.click(open);
  await waitFor(() => { expect(mockNavigate).toHaveBeenCalledTimes(2); });
});

it("reports rejected navigation and keeps the token available", async () => {
  jest.clearAllMocks();
  const error = new Error("Navigation unavailable");
  mockNavigate.mockRejectedValueOnce(error);
  const view = renderAddressCells();
  const [open] = view.getAllByRole("button", { name: "Show full" });
  if (!open) throw new Error("Missing token action");
  fireEvent.click(open);
  await waitFor(() => { expect(reportError).toHaveBeenCalledWith("Failed to open transfer:", error); });
  expect(view.getByText(SHORT_ADDRESS)).toBeTruthy();
  expect(mockNavigate).toHaveBeenCalledTimes(1);
});

it("handles rejected token text and balance copies", async () => {
  const error = new Error("Clipboard unavailable");
  jest.mocked(copyToClipboard).mockRejectedValue(error);
  const view = render(<><CopyableText text="Token" /><BalanceCell amount="1" /></>);
  for (const copy of view.container.querySelectorAll("svg")) fireEvent.click(copy);
  await waitFor(() => {
    expect(reportError).toHaveBeenCalledWith("Failed to copy token text:", error);
    expect(reportError).toHaveBeenCalledWith("Failed to copy token balance:", error);
  });
  jest.mocked(copyToClipboard).mockResolvedValue(true);
});

it("reports a failed hide without selecting or navigating", async () => {
  const error = new Error("Storage unavailable");
  mockHide.mockRejectedValueOnce(error);
  const onRowClick = jest.fn();
  const view = render(<div onClick={onRowClick}><HideTokenButton tokenAddress={ADDRESS} /></div>);
  const hide = view.container.querySelector("svg");
  if (!hide) throw new Error("Missing hide token action");
  fireEvent.click(hide);
  await waitFor(() => { expect(reportError).toHaveBeenCalledWith("Failed to hide token:", error); });
  expect(mockHide).toHaveBeenCalledWith(ADDRESS);
  expect(onRowClick).not.toHaveBeenCalled();
  expect(mockNavigate).not.toHaveBeenCalled();
});
