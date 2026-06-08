import React, { useRef, useEffect } from "react";
import { cn } from "@/utils/cn";

interface PinInputProps {
  length?: number;
  onChange: (pin: string) => void;
  value?: string;
  disabled?: boolean;
  placeholder?: string;
  className?: string;
  description?: string;
  error?: string;
  autoFocus?: boolean;
}

/**
 * Boxed PIN entry — a row of single-digit masked cells used to unlock the
 * encrypted seed before signing. Keeps the original string-based API
 * (`value`/`onChange`) so every call site stays untouched; only the
 * presentation changed from one input to `length` cells.
 */
export const PinInput = ({
  length = 6,
  onChange,
  value = "",
  disabled = false,
  // `placeholder` no longer renders (boxed cells), kept for API compatibility.
  placeholder: _placeholder,
  className,
  description,
  error,
  autoFocus = false,
}: PinInputProps) => {
  const refs = useRef<Array<HTMLInputElement | null>>([]);
  const chars = value.split("").slice(0, length);

  useEffect(() => {
    if (autoFocus) refs.current[0]?.focus();
  }, [autoFocus]);

  const setAt = (i: number, ch: string) => {
    const next = value.split("");
    next[i] = ch;
    onChange(next.join("").replace(/\D/g, "").slice(0, length));
  };

  const handleChange =
    (i: number) => (e: React.ChangeEvent<HTMLInputElement>) => {
      const ch = e.target.value.replace(/\D/g, "").slice(-1);
      if (!ch && !chars[i]) return;
      setAt(i, ch);
      if (ch && i < length - 1) refs.current[i + 1]?.focus();
    };

  const handleKeyDown =
    (i: number) => (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Enter") {
        e.preventDefault();
        return;
      }
      if (e.key === "Backspace" && !chars[i] && i > 0) {
        refs.current[i - 1]?.focus();
      }
      if (e.key === "ArrowLeft" && i > 0) refs.current[i - 1]?.focus();
      if (e.key === "ArrowRight" && i < length - 1) refs.current[i + 1]?.focus();
    };

  const handlePaste =
    (i: number) => (e: React.ClipboardEvent<HTMLInputElement>) => {
      e.preventDefault();
      const digits = e.clipboardData.getData("text").replace(/\D/g, "");
      if (!digits) return;
      const next = value.split("");
      for (let k = 0; k < digits.length && i + k < length; k++) {
        next[i + k] = digits.charAt(k);
      }
      const joined = next.join("").replace(/\D/g, "").slice(0, length);
      onChange(joined);
      refs.current[Math.min(i + digits.length, length - 1)]?.focus();
    };

  return (
    <div className={cn("w-full space-y-2", className)}>
      <div className="flex gap-2">
        {Array.from({ length }).map((_, i) => (
          <input
            key={i}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="password"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={1}
            disabled={disabled}
            value={chars[i] ?? ""}
            onChange={handleChange(i)}
            onKeyDown={handleKeyDown(i)}
            onPaste={handlePaste(i)}
            aria-label={`PIN digit ${i + 1}`}
            className={cn(
              "h-12 w-11 rounded-md border bg-background text-center font-mono text-xl text-foreground outline-none transition-colors",
              "focus-visible:border-[#4aafff] focus-visible:ring-1 focus-visible:ring-[#4aafff]",
              "disabled:cursor-not-allowed disabled:opacity-50",
              error
                ? "border-destructive"
                : chars[i]
                  ? "border-[#4aafff]"
                  : "border-input",
            )}
          />
        ))}
      </div>
      {description && (
        <div className="text-sm text-muted-foreground">{description}</div>
      )}
      {error && (
        <div className="text-sm font-medium text-destructive">{error}</div>
      )}
    </div>
  );
};

export default PinInput;
