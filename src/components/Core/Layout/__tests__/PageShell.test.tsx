/** @jest-environment jsdom */

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { HelmetProvider } from "react-helmet-async";
import { PageShell } from "../PageShell";
import { Card } from "@/components/UI/Card";
import { SEO } from "@/components/SEO/SEO";

jest.mock("@/utils", () => ({
  cn: (...values: unknown[]) => values.filter(Boolean).join(" "),
}));

afterEach(cleanup);

it.each([
  ["default", "max-w-2xl"],
  ["wide", "max-w-3xl"],
] as const)(
  "places the heading before the card at %s width",
  (width, maxWidth) => {
    const { container } = render(
      <PageShell title="Accounts" subtitle="Manage your wallets" width={width}>
        <Card>Account content</Card>
      </PageShell>,
    );
    const heading = screen.getByRole("heading", { level: 1, name: "Accounts" });
    const content = screen.getByText("Account content");
    const frame = heading.closest("header")?.parentElement;
    expect(frame?.classList.contains(maxWidth)).toBe(true);
    expect(frame?.classList.contains("px-4")).toBe(true);
    expect(frame?.classList.contains("pt-8")).toBe(true);
    expect(frame?.classList.contains("pb-8")).toBe(true);
    expect(
      heading.compareDocumentPosition(content) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(content.contains(heading)).toBe(false);
    expect(screen.getByText("Manage your wallets").closest("header")).toBe(
      heading.closest("header"),
    );
    expect(container.querySelectorAll("h1")).toHaveLength(1);
  },
);

it("keeps the optional action in the wrapping heading row and preserves its handler", () => {
  const add = jest.fn();
  render(
    <PageShell title="Address Book" action={<button onClick={add}>Add</button>}>
      <Card>Recipients</Card>
    </PageShell>,
  );
  const heading = screen.getByRole("heading", { level: 1 });
  const button = screen.getByRole("button", { name: "Add" });
  expect(button.closest("header")).toBe(heading.closest("header"));
  expect(heading.closest("header")?.classList.contains("flex-wrap")).toBe(true);
  expect(button.parentElement?.classList.contains("ml-auto")).toBe(true);
  expect(heading.closest("header")?.querySelector("p")).toBeNull();
  fireEvent.click(button);
  expect(add).toHaveBeenCalledTimes(1);
});

it("uses the default width and preserves status announcements in a rich title", () => {
  render(
    <PageShell title={<span aria-live="polite">Waiting for approval</span>}>
      <Card>Transaction details</Card>
    </PageShell>,
  );
  const heading = screen.getByRole("heading", {
    level: 1,
    name: "Waiting for approval",
  });
  expect(heading.querySelector('[aria-live="polite"]')).toBeTruthy();
  expect(heading.closest('[data-page-shell="default"]')).toBeTruthy();
});

it("updates the document and social titles when navigating between shells", async () => {
  const view = render(
    <HelmetProvider>
      <PageShell title="Address Book" seoTitle="Address Book">
        <Card>Recipients</Card>
      </PageShell>
    </HelmetProvider>,
  );
  await waitFor(() =>
    expect(document.title).toBe("Address Book | MyQRLWallet"),
  );
  view.rerender(
    <HelmetProvider>
      <PageShell
        title="dApp connections"
        width="wide"
        seoTitle="dApp Connections"
      >
        <Card>Sessions</Card>
      </PageShell>
    </HelmetProvider>,
  );
  await waitFor(() =>
    expect(document.title).toBe("dApp Connections | MyQRLWallet"),
  );
  expect(
    document
      .querySelector('meta[property="og:title"]')
      ?.getAttribute("content"),
  ).toBe("dApp Connections | MyQRLWallet");
  expect(
    document
      .querySelector('meta[name="twitter:title"]')
      ?.getAttribute("content"),
  ).toBe("dApp Connections | MyQRLWallet");
});

it("preserves route metadata when the route supplies its own SEO", async () => {
  render(
    <HelmetProvider>
      <SEO
        title="Create Account"
        description="Create a quantum-resistant account."
      />
      <PageShell title="Create new account">
        <Card>Password fields</Card>
      </PageShell>
    </HelmetProvider>,
  );
  await waitFor(() =>
    expect(document.title).toBe("Create Account | MyQRLWallet"),
  );
  expect(
    document.querySelector('meta[name="description"]')?.getAttribute("content"),
  ).toBe("Create a quantum-resistant account.");
});
