/**
 * Phone decimal keypads in comma locales offer only a comma, so one comma is
 * read as the decimal mark ("1,5" is 1.5) and surrounding spaces are dropped.
 * A comma that could group thousands ("1,000", "12,345,678") or that appears
 * next to a dot stays in the value, and validation refuses it.
 */
export function normalizeAmount(text: string): string {
  const trimmed = text.trim();
  if (!trimmed.includes(",")) return trimmed;
  return /^\d*,(\d{1,2}|\d{4,})$/.test(trimmed) ? trimmed.replace(",", ".") : trimmed;
}
