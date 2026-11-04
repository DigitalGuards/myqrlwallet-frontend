import { MoveLeft } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/utils/cn";

type BackButtonProps = {
  onClick: () => void;
  disabled?: boolean;
  /**
   * Accessible name for a Back that steps out of a view inside a page. It
   * starts with the visible word, so voice control can still say "Back".
   */
  label?: string;
  className?: string;
};

/**
 * The wallet's Back control, after the browser extension's: an arrow and
 * the word, left aligned above the title it belongs to. On hover the arrow
 * takes the accent colour and the control nudges left.
 */
export function BackButton({
  onClick,
  disabled = false,
  label,
  className,
}: BackButtonProps) {
  const { t } = useTranslation("common");
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      className={cn(
        "inline-flex w-fit items-center gap-2 whitespace-nowrap rounded-md py-2 text-foreground",
        "transition-[margin,color] motion-reduce:transition-none",
        "enabled:cursor-pointer enabled:hover:-ml-1 enabled:hover:text-secondary",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
        "disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
    >
      <MoveLeft aria-hidden="true" className="size-6 shrink-0" />
      <span className="text-lg font-medium leading-none text-foreground">
        {t("back")}
      </span>
    </button>
  );
}
