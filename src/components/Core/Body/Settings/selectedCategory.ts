// The wide layout's selected settings category is remembered for the browser
// session, so a reload or a visit to another page returns to it.
const KEY = "settingsCategory";

export function readSelectedCategory(): string | null {
  try {
    return sessionStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export function saveSelectedCategory(id: string): void {
  try {
    sessionStorage.setItem(KEY, id);
  } catch {
    // Storage unavailable: the choice lasts until the page closes.
  }
}
