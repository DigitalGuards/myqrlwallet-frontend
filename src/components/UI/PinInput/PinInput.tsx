import React, { useState, useRef, useEffect } from "react";
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
  length = 4,
  onChange,
  value = "",
  disabled = false,
  placeholder = "Enter PIN",
  className,
  description,
  error,
  autoFocus = false,
}: PinInputProps) => {
  const [pin, setPin] = useState(value);
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
      setPin(newValue);
      onChange(newValue);
    }
  };

  // Prevent form submission
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
  };

  return (
    <div className={cn("w-full space-y-2", className)}>
      <form onSubmit={handleSubmit} className="w-full">
        <Input
          ref={inputRef}
          type="password"
          inputMode="numeric"
          placeholder={placeholder}
          value={pin}
          onChange={handleChange}
          disabled={disabled}
          autoComplete="current-password"
          className={cn(
            "placeholder:text-left placeholder:tracking-normal", 
            pin.length > 0 ? "text-center tracking-widest" : "text-left tracking-normal",
            error ? "border-destructive" : ""
          )}
        />
      </form>
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
