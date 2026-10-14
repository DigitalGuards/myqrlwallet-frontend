/** @jest-environment jsdom */
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import type { ReactNode } from "react";
import { reportError } from "@/utils/reportError";
import TokenForm from "../TokenForm";

const mockDiscover = jest.fn<Promise<unknown[]>, [string]>();
const mockRefresh = jest.fn<Promise<void>, []>();
const mockNavigate = jest.fn<Promise<void>, [string]>();
const mockStore = {
  qrlStore: { activeAccount: { accountAddress: "holder" } },
  tokenStore: {
    visibleTokenList: [],
    pendingDiscoveredTokens: [],
    discoverTokensForReview: mockDiscover,
    refreshTokenBalances: mockRefresh,
    setRefreshingBalances: jest.fn(),
  },
};
function MockContainer({ children }: { children: ReactNode }) {
  return <div>{children}</div>;
}
jest.mock("@/stores/store", () => ({ useStore: () => mockStore }));
jest.mock("react-router", () => ({ useNavigate: () => mockNavigate }));
jest.mock("@/router/router", () => ({
  ROUTES: { CREATE_TOKEN: "/create-token" },
}));
jest.mock("@/utils/reportError", () => ({ reportError: jest.fn() }));
jest.mock("@/utils", () => ({
  cn: (...values: unknown[]) =>
    values.filter((value) => typeof value === "string").join(" "),
}));
jest.mock("../../AddTokenModal/AddTokenModal", () => ({
  AddTokenModal: () => null,
}));
jest.mock("../data-table", () => ({
  DataTable: ({ emptyMessage }: { emptyMessage: ReactNode }) => (
    <>{emptyMessage}</>
  ),
}));
jest.mock("@/components/UI/DropdownMenu", () => ({
  DropdownMenu: MockContainer,
  DropdownMenuContent: MockContainer,
  DropdownMenuTrigger: MockContainer,
  DropdownMenuItem: ({
    onClick,
    children,
  }: {
    onClick: () => void;
    children: ReactNode;
  }) => <button onClick={onClick}>{children}</button>,
}));
beforeEach(() => {
  jest.clearAllMocks();
  jest.useFakeTimers();
  mockDiscover.mockResolvedValue([]);
  mockRefresh.mockResolvedValue();
  mockNavigate.mockResolvedValue();
});
afterEach(() => {
  cleanup();
  jest.useRealTimers();
});

it("reports rejected discovery and leaves the empty token list visible", async () => {
  const error = new Error("Explorer unavailable");
  mockDiscover.mockRejectedValueOnce(error);
  render(<TokenForm />);
  await waitFor(() => {
    expect(reportError).toHaveBeenCalledWith(
      "Failed to discover tokens:",
      error,
    );
  });
  expect(screen.getByText("No tokens yet")).toBeTruthy();
});

it("reports a failed refresh and releases its loading state", async () => {
  const error = new Error("RPC unavailable");
  mockRefresh.mockRejectedValueOnce(error);
  const view = render(<TokenForm />);
  const refresh = view.container.querySelector("button");
  if (!refresh) throw new Error("Missing refresh action");
  fireEvent.click(refresh);
  await waitFor(() => {
    expect(reportError).toHaveBeenCalledWith(
      "Failed to refresh tokens:",
      error,
    );
  });
  expect(mockStore.tokenStore.setRefreshingBalances).toHaveBeenCalledWith(true);
  expect(view.container.querySelector(".animate-spin")).toBeNull();
});

it("reports rejected create-token navigation", async () => {
  const error = new Error("Navigation unavailable");
  mockNavigate.mockRejectedValueOnce(error);
  render(<TokenForm />);
  const [create] = screen.getAllByRole("button", { name: "Create New Token" });
  if (!create) throw new Error("Missing create action");
  fireEvent.click(create);
  await waitFor(() => {
    expect(reportError).toHaveBeenCalledWith(
      "Failed to open token creation:",
      error,
    );
  });
  expect(mockNavigate).toHaveBeenCalledWith("/create-token");
});
