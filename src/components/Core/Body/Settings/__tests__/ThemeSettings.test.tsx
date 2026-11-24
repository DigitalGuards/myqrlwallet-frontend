/** @jest-environment jsdom */
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ThemeSettings } from "../ThemeSettings";
import { initTheme, THEME_STORAGE_KEY } from "@/theme/preference";

jest.mock("@/utils", () =>
  jest.requireActual<typeof import("@/utils/cn")>("@/utils/cn"),
);

let stop: () => void;

beforeEach(() => {
  localStorage.clear();
  const reset = initTheme();
  window.dispatchEvent(new StorageEvent("storage", { key: null }));
  reset();
  delete document.documentElement.dataset["theme"];
  stop = initTheme();
});

afterEach(() => {
  stop();
  cleanup();
});

it("renders a labelled select with the three choices, System by default", () => {
  render(<ThemeSettings />);
  const select = screen.getByLabelText("Theme");
  expect(select).toHaveProperty("value", "system");
  expect(select.getAttribute("aria-describedby")).toBe("wallet-theme-hint");
  expect(
    screen.getAllByRole("option").map((option) => option.textContent),
  ).toEqual(["Dark", "Light", "System"]);
});

it("saves the choice and applies it", () => {
  render(<ThemeSettings />);
  fireEvent.change(screen.getByLabelText("Theme"), {
    target: { value: "light" },
  });
  expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('"light"');
  expect(document.documentElement.dataset["theme"]).toBe("light");
  fireEvent.change(screen.getByLabelText("Theme"), {
    target: { value: "dark" },
  });
  expect(document.documentElement.dataset["theme"]).toBeUndefined();
});

it("starts on the saved choice", () => {
  localStorage.setItem(THEME_STORAGE_KEY, '"light"');
  render(<ThemeSettings />);
  expect(screen.getByLabelText("Theme")).toHaveProperty("value", "light");
});

it("follows a change made in another tab", () => {
  render(<ThemeSettings />);
  expect(screen.getByLabelText("Theme")).toHaveProperty("value", "system");
  act(() => {
    localStorage.setItem(THEME_STORAGE_KEY, '"light"');
    window.dispatchEvent(
      new StorageEvent("storage", { key: THEME_STORAGE_KEY }),
    );
  });
  expect(screen.getByLabelText("Theme")).toHaveProperty("value", "light");
  expect(document.documentElement.dataset["theme"]).toBe("light");
});
