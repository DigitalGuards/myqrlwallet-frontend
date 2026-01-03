import { useState, useCallback, useEffect } from "react";

export function useCopyToClipboard<T extends string>(timeout = 1500) {
  const [copiedItem, setCopiedItem] = useState<T | null>(null);

  const copyToClipboard = useCallback((text: string, type: T) => {
    navigator.clipboard
      .writeText(text)
      .then(() => {
        setCopiedItem(type);
      })
      .catch((err) => {
        console.error("Failed to copy text to clipboard: ", err);
      });
  }, []);

  useEffect(() => {
    if (copiedItem) {
      const timer = setTimeout(() => {
        setCopiedItem(null);
      }, timeout);

      return () => clearTimeout(timer);
    }
  }, [copiedItem, timeout]);

  return { copiedItem, copyToClipboard };
}
