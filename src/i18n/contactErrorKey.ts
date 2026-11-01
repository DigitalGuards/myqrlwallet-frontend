/** The address-book storage API retains its existing return values. */
export interface ContactError {
  key:
    | "contacts:nameRequired"
    | "contacts:nameInvalid"
    | "contacts:invalidAddress"
    | "contacts:alreadySaved"
    | "contacts:serviceError";
  reason?: string;
}

export function contactErrorKey(message: string): ContactError {
  switch (message) {
    case "Name is required":
      return { key: "contacts:nameRequired" };
    case "Name has hidden characters or is too long":
      return { key: "contacts:nameInvalid" };
    case "Not a valid QRL address (Q + 128 hex characters)":
      return { key: "contacts:invalidAddress" };
    case "This address is already saved":
      return { key: "contacts:alreadySaved" };
    default:
      return { key: "contacts:serviceError", reason: message };
  }
}
