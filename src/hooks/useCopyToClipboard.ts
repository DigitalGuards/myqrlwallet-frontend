import { useState, useCallback, useEffect } from "react";
import { copyToClipboard as copyToClipboardUtil } from "@/utils/nativeApp";

export function useCopyToClipboard<T extends string>(timeout = 1500) {
  const [copiedItem, setCopiedItem] = useState<T | null>(null);

  const copyToClipboard = useCallback(async (text: string, type: T) => {
    const success = await copyToClipboardUtil(text);
    if (success) {
      setCopiedItem(type);
    }
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
