import React, { useRef, useEffect } from "react";
import { Input } from "../Input";
import { cn } from "@/lib/utils";

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

export const PinInput = ({
  length = 6,
  onChange,
  value = "",
  disabled = false,
  placeholder = "Enter PIN",
  className,
  description,
  error,
  autoFocus = false,
}: PinInputProps) => {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (autoFocus && inputRef.current) {
      inputRef.current.focus();
    }
  }, [autoFocus]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = e.target.value;

    // Only allow digits and limit to specified length
    if (/^\d*$/.test(newValue) && newValue.length <= length) {
      onChange(newValue);
    }
  };

  // Prevent Enter key from submitting parent form
  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
    }
  };

  return (
    <div className={cn("w-full space-y-2", className)}>
      <Input
        ref={inputRef}
        type="password"
        inputMode="numeric"
        placeholder={placeholder}
        value={value}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        disabled={disabled}
        autoComplete="current-password"
        className={cn(
          "placeholder:text-left placeholder:tracking-normal",
          value.length > 0 ? "text-center tracking-widest" : "text-left tracking-normal",
          error ? "border-destructive" : ""
        )}
      />
      {description && (
        <div className="text-sm text-muted-foreground">
          {description}
        </div>
      )}
      {error && (
        <div className="text-sm font-medium text-destructive">
          {error}
        </div>
      )}
    </div>
  );
};

export default PinInput;
