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
  // Marks a focus move as programmatic (auto-advance / backspace / arrows /
  // paste) so the cell's onFocus does not bounce it back. focus() fires the
  // focus event synchronously, before React re-renders with the new value, so
  // onFocus would otherwise read a stale (shorter) value and redirect.
  const advancingRef = useRef(false);
  const chars = value.split("").slice(0, length);

  const focusCell = (idx: number) => {
    advancingRef.current = true;
    refs.current[idx]?.focus();
  };

  useEffect(() => {
    if (autoFocus) {
      advancingRef.current = true;
      refs.current[0]?.focus();
    }
  }, [autoFocus]);

  const setAt = (i: number, ch: string) => {
    const next = value.split("");
    next[i] = ch;
    onChange(next.join("").replace(/\D/g, "").slice(0, length));
  };

  const handleChange =
    (i: number) => (e: React.ChangeEvent<HTMLInputElement>) => {
      const ch = e.target.value.slice(-1);
      // Ignore non-digits outright so focus doesn't advance and the
      // current cell isn't cleared.
      if (ch && !/\d/.test(ch)) return;
      if (!ch && !chars[i]) return;
      setAt(i, ch);
      if (ch && i < length - 1) focusCell(i + 1);
    };

  const handleKeyDown =
    (i: number) => (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Enter") {
        e.preventDefault();
        return;
      }
      // Backspace on an empty cell deletes the previous digit (not just
      // moves focus), so one press removes one digit.
      if (e.key === "Backspace" && !chars[i] && i > 0) {
        onChange(value.slice(0, -1));
        focusCell(i - 1);
      }
      if (e.key === "ArrowLeft" && i > 0) focusCell(i - 1);
      if (e.key === "ArrowRight" && i < length - 1) focusCell(i + 1);
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
      focusCell(Math.min(i + digits.length, length - 1));
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
            onFocus={() => {
              // Skip the redirect when we moved focus ourselves (the value
              // here is stale until the next render).
              if (advancingRef.current) {
                advancingRef.current = false;
                return;
              }
              // Keep manual entry sequential: clicking a cell past the first
              // empty one redirects to that empty cell.
              if (i > value.length) refs.current[value.length]?.focus();
            }}
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
