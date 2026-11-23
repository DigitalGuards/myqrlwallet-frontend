/** @jest-environment jsdom */
import { useState, type ReactNode } from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { SettingsLayout, type SettingsCategory } from "../SettingsLayout";
import { SettingsBusyProvider } from "../SettingsBusyProvider";

// A controllable (min-width: 64rem) media query.
let isWide = false;
let listeners: (() => void)[] = [];
function installMatchMedia() {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: () => ({
      get matches() {
        return isWide;
      },
      addEventListener: (_type: string, listener: () => void) => {
        listeners.push(listener);
      },
      removeEventListener: (_type: string, listener: () => void) => {
        listeners = listeners.filter((item) => item !== listener);
      },
    }),
  });
}
const crossTo = (wide: boolean) => {
  isWide = wide;
  act(() => {
    listeners.forEach((listener) => {
      listener();
    });
  });
};

function Field({ id }: { id: string }) {
  const [value, setValue] = useState("");
  const [message, setMessage] = useState(false);
  return (
    <>
      <input
        aria-label={`field-${id}`}
        value={value}
        onChange={(event) => {
          setValue(event.target.value);
        }}
      />
      <button
        type="button"
        aria-expanded="false"
        onClick={() => {
          setMessage(true);
        }}
      >
        raise-{id}
      </button>
      {message && <p role="alert">message-{id}</p>}
    </>
  );
}

const make = (ids: string[], open?: string): SettingsCategory[] =>
  ids.map((id) => ({
    id,
    label: `Label ${id}`,
    content: (
      <section aria-labelledby={`h-${id}`}>
        <h2 id={`h-${id}`}>Heading {id}</h2>
        <Field id={id} />
        {open === id && (
          <button type="button" aria-expanded="true">
            open-{id}
          </button>
        )}
      </section>
    ),
  }));

const pane = (id: string) =>
  document.querySelector<HTMLElement>(`[data-category="${id}"]`);
const selectedIds = () =>
  [...document.querySelectorAll<HTMLElement>("[data-category]")]
    .filter((element) => element.dataset["selected"] === "true")
    .map((element) => element.dataset["category"]);
const tab = (name: string) => screen.getByRole("tab", { name });

function renderLayout(
  categories: SettingsCategory[],
  extra: { requested?: string; pending?: boolean; forced?: boolean } = {},
) {
  const ui = (list: SettingsCategory[], more = extra): ReactNode => (
    <SettingsBusyProvider forced={more.forced ?? false}>
      <SettingsLayout
        categories={list}
        requested={more.requested}
        pending={more.pending}
      />
    </SettingsBusyProvider>
  );
  const view = render(ui(categories));
  return {
    ...view,
    update: (list: SettingsCategory[], more = extra) => {
      view.rerender(ui(list, more));
    },
  };
}

beforeEach(() => {
  sessionStorage.clear();
  isWide = false;
  listeners = [];
  installMatchMedia();
});
afterEach(cleanup);

describe("wide layout (lg and up): vertical tabs", () => {
  beforeEach(() => {
    isWide = true;
  });

  it("is a named vertical tablist with the first category selected", () => {
    renderLayout(make(["a", "b", "c"]));
    const list = screen.getByRole("tablist", { name: "Settings" });
    expect(list.getAttribute("aria-orientation")).toBe("vertical");
    expect(list.className).toContain("lg:block");
    const tabs = screen.getAllByRole("tab");
    expect(tabs.map((item) => item.textContent)).toEqual([
      "Label a",
      "Label b",
      "Label c",
    ]);
    expect(tabs.map((item) => item.getAttribute("aria-selected"))).toEqual([
      "true",
      "false",
      "false",
    ]);
    expect(selectedIds()).toEqual(["a"]);
  });

  it("links each tab and panel to the other", () => {
    renderLayout(make(["a", "b"]));
    for (const id of ["a", "b"]) {
      const item = tab(`Label ${id}`);
      const panel = pane(id);
      expect(item.getAttribute("aria-controls")).toBe(panel?.id);
      expect(panel?.getAttribute("role")).toBe("tabpanel");
      expect(panel?.getAttribute("aria-labelledby")).toBe(item.id);
    }
    // The visible heading stays in the pane.
    expect(screen.getByRole("heading", { name: "Heading a" })).toBeTruthy();
  });

  it("hides the unselected panes at lg without unmounting them", () => {
    renderLayout(make(["a", "b"]));
    expect(pane("a")?.className).not.toContain("lg:hidden");
    expect(pane("b")?.className).toContain("lg:hidden");
    expect(screen.getByLabelText("field-b")).toBeTruthy();
  });

  it("switches on click and remembers the category for the session", () => {
    const view = renderLayout(make(["a", "b", "c"]));
    fireEvent.click(tab("Label b"));
    expect(selectedIds()).toEqual(["b"]);
    expect(sessionStorage.getItem("settingsCategory")).toBe("b");
    view.unmount();
    renderLayout(make(["a", "b", "c"]));
    expect(selectedIds()).toEqual(["b"]);
  });

  it("falls back to the first category for an unknown one", () => {
    sessionStorage.setItem("settingsCategory", "security");
    renderLayout(make(["a", "b"]));
    expect(selectedIds()).toEqual(["a"]);
  });

  it("keeps typed input and every pane mounted across category changes", () => {
    renderLayout(make(["a", "b"]));
    const fieldA = screen.getByLabelText("field-a");
    fireEvent.change(fieldA, { target: { value: "kept" } });
    fireEvent.click(tab("Label b"));
    fireEvent.click(tab("Label a"));
    expect(screen.getByLabelText("field-a")).toBe(fieldA);
    expect(fieldA).toHaveProperty("value", "kept");
  });

  it("moves with the arrow keys, Home and End, wrapping at the ends", () => {
    renderLayout(make(["a", "b", "c"]));
    const list = screen.getByRole("tablist");
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

  it.each(["ctrlKey", "metaKey", "altKey"])(
    "leaves the arrow keys alone with %s held",
    (modifier) => {
      renderLayout(make(["a", "b"]));
      fireEvent.keyDown(screen.getByRole("tablist"), {
        key: "ArrowDown",
        [modifier]: true,
      });
      expect(selectedIds()).toEqual(["a"]);
    },
  );

  it("keeps one tab stop: the selected tab", () => {
    renderLayout(make(["a", "b"]));
    expect(tab("Label a").tabIndex).toBe(0);
    expect(tab("Label b").tabIndex).toBe(-1);
    fireEvent.click(tab("Label b"));
    expect(tab("Label b").tabIndex).toBe(0);
    expect(tab("Label a").tabIndex).toBe(-1);
  });
});

describe("narrow layout (below lg): ordinary sections", () => {
  it("renders every category once, in order, with no tab or panel roles", () => {
    renderLayout(make(["a", "b", "security"]));
    const order = [...document.querySelectorAll("[data-category]")].map(
      (element) => element.getAttribute("data-category"),
    );
    expect(order).toEqual(["a", "b", "security"]);
    expect(screen.getAllByRole("heading", { level: 2 })).toHaveLength(3);
    expect(screen.queryAllByRole("tabpanel")).toHaveLength(0);
    expect(pane("a")?.getAttribute("aria-labelledby")).toBeNull();
    expect(screen.getAllByRole("region")).toHaveLength(3);
    expect(pane("security")?.className).toContain("pt-4");
  });

  it("hides the tablist below lg", () => {
    renderLayout(make(["a", "b"]));
    const list = document.querySelector('[role="tablist"]');
    expect(list?.className).toContain("hidden");
    expect(list?.className).toContain("lg:block");
  });
});

describe("crossing to lg", () => {
  it("opens the category that holds the focused element", () => {
    renderLayout(make(["a", "b", "c"]));
    screen.getByLabelText("field-c").focus();
    crossTo(true);
    expect(selectedIds()).toEqual(["c"]);
    expect(pane("c")?.getAttribute("role")).toBe("tabpanel");
  });

  it("uses the focus it just lost when the pane is hidden under it", () => {
    renderLayout(make(["a", "b", "c"]));
    const field = screen.getByLabelText("field-b");
    field.focus();
    field.blur();
    crossTo(true);
    expect(selectedIds()).toEqual(["b"]);
  });

  it("without focus, prefers a category with an open panel to the stored one", () => {
    renderLayout(make(["a", "b", "c"], "c"));
    crossTo(true);
    expect(selectedIds()).toEqual(["c"]);
  });

  it("without focus or an open panel, keeps the stored category", () => {
    sessionStorage.setItem("settingsCategory", "b");
    renderLayout(make(["a", "b", "c"]));
    crossTo(true);
    expect(selectedIds()).toEqual(["b"]);
  });

  it("returns to ordinary sections when it narrows again", () => {
    isWide = true;
    renderLayout(make(["a", "b"]));
    expect(pane("a")?.getAttribute("role")).toBe("tabpanel");
    crossTo(false);
    expect(pane("a")?.getAttribute("role")).toBeNull();
  });
});

describe("a running operation", () => {
  beforeEach(() => {
    isWide = true;
  });

  it("keeps the list on the category in use", () => {
    renderLayout(make(["a", "b"]), { forced: true });
    const other = tab("Label b");
    expect(other.getAttribute("aria-disabled")).toBe("true");
    expect(tab("Label a").getAttribute("aria-disabled")).toBeNull();
    fireEvent.click(other);
    fireEvent.keyDown(screen.getByRole("tablist"), { key: "ArrowDown" });
    fireEvent.keyDown(screen.getByRole("tablist"), { key: "End" });
    expect(selectedIds()).toEqual(["a"]);
  });

  it("lets the list move again when the operation ends", () => {
    const view = renderLayout(make(["a", "b"]), { forced: true });
    fireEvent.click(tab("Label b"));
    expect(selectedIds()).toEqual(["a"]);
    view.update(make(["a", "b"]), { forced: false });
    expect(tab("Label b").getAttribute("aria-disabled")).toBeNull();
    fireEvent.click(tab("Label b"));
    expect(selectedIds()).toEqual(["b"]);
  });
});

describe("a message in a category that is not shown", () => {
  it("brings that category up when it appears (wide)", async () => {
    isWide = true;
    renderLayout(make(["a", "b"]));
    expect(selectedIds()).toEqual(["a"]);
    await act(async () => {
      fireEvent.click(screen.getByText("raise-b"));
      await Promise.resolve();
    });
    expect(screen.getByText("message-b")).toBeTruthy();
    expect(selectedIds()).toEqual(["b"]);
  });

  it("leaves the selection alone for a message in the selected category", async () => {
    isWide = true;
    renderLayout(make(["a", "b"]));
    await act(async () => {
      fireEvent.click(screen.getByText("raise-a"));
      await Promise.resolve();
    });
    expect(selectedIds()).toEqual(["a"]);
  });

  it("does nothing below lg, where every category shows", async () => {
    renderLayout(make(["a", "b"]));
    await act(async () => {
      fireEvent.click(screen.getByText("raise-b"));
      await Promise.resolve();
    });
    expect(selectedIds()).toEqual(["a"]);
  });
});

describe("deep links and the pending check", () => {
  it("opens the requested category", () => {
    renderLayout(make(["a", "b", "c"]), { requested: "c" });
    expect(selectedIds()).toEqual(["c"]);
    expect(sessionStorage.getItem("settingsCategory")).toBe("c");
  });

  it("follows a later request", () => {
    const view = renderLayout(make(["a", "b", "c"]));
    view.update(make(["a", "b", "c"]), { requested: "b" });
    expect(selectedIds()).toEqual(["b"]);
  });

  it("ignores an unknown request", () => {
    renderLayout(make(["a", "b"]), { requested: "nope" });
    expect(selectedIds()).toEqual(["a"]);
  });

  it("holds the fallback while the list is still being decided", () => {
    isWide = true;
    sessionStorage.setItem("settingsCategory", "security");
    const view = renderLayout(make(["a", "b"]), { pending: true });
    expect(selectedIds()).toEqual([]);
    expect(tab("Label a").tabIndex).toBe(0);
    view.update(make(["a", "b", "security"]), { pending: false });
    expect(selectedIds()).toEqual(["security"]);
  });

  it("falls back to the first category once nothing more is pending", () => {
    sessionStorage.setItem("settingsCategory", "security");
    const view = renderLayout(make(["a", "b"]), { pending: true });
    view.update(make(["a", "b"]), { pending: false });
    expect(selectedIds()).toEqual(["a"]);
  });
});
