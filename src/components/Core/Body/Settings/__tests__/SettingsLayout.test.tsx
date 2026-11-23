/** @jest-environment jsdom */
import { useState } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { SettingsLayout, type SettingsCategory } from "../SettingsLayout";

function Field({ id }: { id: string }) {
  const [value, setValue] = useState("");
  return (
    <input
      aria-label={`field-${id}`}
      value={value}
      onChange={(event) => {
        setValue(event.target.value);
      }}
    />
  );
}

const categories = (ids: string[]): SettingsCategory[] =>
  ids.map((id) => ({
    id,
    label: `Label ${id}`,
    content: (
      <section aria-labelledby={`h-${id}`}>
        <h2 id={`h-${id}`}>Heading {id}</h2>
        <Field id={id} />
      </section>
    ),
  }));

const pane = (id: string) =>
  document.querySelector<HTMLElement>(`[data-category="${id}"]`);
const selectedIds = () =>
  [...document.querySelectorAll<HTMLElement>("[data-category]")]
    .filter((element) => element.dataset["selected"] === "true")
    .map((element) => element.dataset["category"]);

beforeEach(() => {
  sessionStorage.clear();
});
afterEach(cleanup);

describe("wide layout (lg and up)", () => {
  it("lists every category and selects the first by default", () => {
    render(<SettingsLayout categories={categories(["a", "b", "c"])} />);
    const list = screen.getByRole("navigation", { name: "Settings" });
    expect(list.className).toContain("lg:block");
    const items = screen.getAllByRole("button", { name: /^Label / });
    expect(items.map((item) => item.textContent)).toEqual([
      "Label a",
      "Label b",
      "Label c",
    ]);
    expect(items[0]?.getAttribute("aria-current")).toBe("page");
    expect(items[1]?.getAttribute("aria-current")).toBeNull();
    expect(selectedIds()).toEqual(["a"]);
  });

  it("hides the unselected categories at lg without unmounting them", () => {
    render(<SettingsLayout categories={categories(["a", "b"])} />);
    expect(pane("a")?.className).not.toContain("lg:hidden");
    expect(pane("b")?.className).toContain("lg:hidden");
    expect(screen.getByLabelText("field-b")).toBeTruthy();
  });

  it("switches category on click and remembers it for the session", () => {
    const view = render(
      <SettingsLayout categories={categories(["a", "b", "c"])} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Label b" }));
    expect(selectedIds()).toEqual(["b"]);
    expect(sessionStorage.getItem("settingsCategory")).toBe("b");
    view.unmount();
    render(<SettingsLayout categories={categories(["a", "b", "c"])} />);
    expect(selectedIds()).toEqual(["b"]);
  });

  it("falls back to the first category for an unknown or removed one", () => {
    sessionStorage.setItem("settingsCategory", "security");
    render(<SettingsLayout categories={categories(["a", "b"])} />);
    expect(selectedIds()).toEqual(["a"]);
  });

  it("keeps typed input and every pane mounted across category changes", () => {
    render(<SettingsLayout categories={categories(["a", "b"])} />);
    const fieldA = screen.getByLabelText("field-a");
    fireEvent.change(fieldA, { target: { value: "kept" } });
    fireEvent.click(screen.getByRole("button", { name: "Label b" }));
    fireEvent.click(screen.getByRole("button", { name: "Label a" }));
    expect(screen.getByLabelText("field-a")).toBe(fieldA);
    expect(fieldA).toHaveProperty("value", "kept");
  });

  it("moves with the arrow keys, Home and End, wrapping at the ends", () => {
    render(<SettingsLayout categories={categories(["a", "b", "c"])} />);
    const list = screen.getByRole("list");
    const press = (key: string) => {
      fireEvent.keyDown(list, { key });
    };
    press("ArrowDown");
    expect(selectedIds()).toEqual(["b"]);
    expect(document.activeElement?.textContent).toBe("Label b");
    press("ArrowDown");
    press("ArrowDown");
    expect(selectedIds()).toEqual(["a"]);
    press("ArrowUp");
    expect(selectedIds()).toEqual(["c"]);
    press("Home");
    expect(selectedIds()).toEqual(["a"]);
    press("End");
    expect(selectedIds()).toEqual(["c"]);
    press("x");
    expect(selectedIds()).toEqual(["c"]);
  });

  it("keeps one tab stop: the selected item", () => {
    render(<SettingsLayout categories={categories(["a", "b"])} />);
    const first = screen.getByRole("button", { name: "Label a" });
    const second = screen.getByRole("button", { name: "Label b" });
    expect(first.tabIndex).toBe(0);
    expect(second.tabIndex).toBe(-1);
    fireEvent.click(second);
    expect(second.tabIndex).toBe(0);
    expect(first.tabIndex).toBe(-1);
  });
});

describe("narrow layout (below lg)", () => {
  it("renders all categories once, in order, as one column", () => {
    render(
      <SettingsLayout categories={categories(["a", "b", "security"])} />,
    );
    const order = [...document.querySelectorAll("[data-category]")].map(
      (element) => element.getAttribute("data-category"),
    );
    expect(order).toEqual(["a", "b", "security"]);
    expect(screen.getAllByRole("heading", { level: 2 })).toHaveLength(3);
    expect(pane("security")?.className).toContain("pt-4");
  });

  it("hides the category list below lg", () => {
    render(<SettingsLayout categories={categories(["a", "b"])} />);
    const list = screen.getByRole("navigation", { name: "Settings" });
    expect(list.className).toContain("hidden");
    expect(list.className).toContain("lg:block");
  });
});
