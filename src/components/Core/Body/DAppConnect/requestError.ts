/** Format wallet display copy while callers retain the protocol error. */
export function formatDAppRequestError(
  message: string,
  method: string,
): string {
  if (!message.trim()) return "The request failed.";
  if (method === "qrl_signTypedData") {
    const reason = message.replace(/^Typed[ -]data signing failed: /, "");
    if (reason.startsWith("cyclic type reference:")) {
      return "Typed data contains a circular type reference.";
    }
    if (/^(?:type(?: graph)?|value) nesting too deep:/.test(reason)) {
      return "Typed data is nested too deeply.";
    }
  }
  return message;
}
