import { useState, useCallback } from "react";

export function useCopyToClipboard<T extends string>(timeout = 1500) {
  const [copiedItem, setCopiedItem] = useState<T | null>(null);

  const copyToClipboard = useCallback(
    (text: string, type: T) => {
      navigator.clipboard.writeText(text);
      setCopiedItem(type);
      setTimeout(() => {
        setCopiedItem(null);
      }, timeout);
    },
    [timeout]
  );

  return { copiedItem, copyToClipboard };
}
