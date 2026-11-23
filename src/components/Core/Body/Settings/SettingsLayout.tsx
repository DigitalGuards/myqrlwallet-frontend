import { useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@/utils/cn";
import { readSelectedCategory, saveSelectedCategory } from "./selectedCategory";

export type SettingsCategory = {
  id: string;
  label: string;
  content: ReactNode;
};

/**
 * One settings page for every width. Every category is rendered once.
 *
 * Below lg the categories stack as sections in one column, in order, and the
 * category list is hidden. From lg up the list shows on the left and only the
 * selected category is displayed on the right. The switch is CSS only, so a
 * resize across the breakpoint cannot remount a section: an open Change PIN
 * panel, typed input and form state stay as they are. Categories that are not
 * selected are display:none at lg, which also removes them from the
 * accessibility tree and the tab order.
 */
export function SettingsLayout({
  categories,
}: {
  categories: SettingsCategory[];
}) {
  const { t } = useTranslation("common");
  const [stored, setStored] = useState(readSelectedCategory);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const selected =
    categories.find((category) => category.id === stored) ?? categories[0];

  const select = (index: number, focus: boolean) => {
    const target = categories[index];
    if (!target) return;
    saveSelectedCategory(target.id);
    setStored(target.id);
    if (focus) itemRefs.current[index]?.focus();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLUListElement>) => {
    const current = categories.findIndex(
      (category) => category.id === selected?.id,
    );
    const last = categories.length - 1;
    let next: number;
    switch (event.key) {
      case "ArrowDown":
        next = current >= last ? 0 : current + 1;
        break;
      case "ArrowUp":
        next = current <= 0 ? last : current - 1;
        break;
      case "Home":
        next = 0;
        break;
      case "End":
        next = last;
        break;
      default:
        return;
    }
    event.preventDefault();
    select(next, true);
  };

  return (
    <div className="max-w-2xl lg:grid lg:max-w-none lg:grid-cols-[13rem_minmax(0,1fr)] lg:gap-10">
      <nav aria-label={t("settings")} className="hidden lg:block">
        <ul className="space-y-0.5" onKeyDown={onKeyDown}>
          {categories.map((category, index) => {
            const current = category.id === selected?.id;
            return (
              <li key={category.id}>
                <button
                  type="button"
                  ref={(element) => {
                    itemRefs.current[index] = element;
                  }}
                  aria-current={current ? "page" : undefined}
                  tabIndex={current ? 0 : -1}
                  onClick={() => {
                    select(index, false);
                  }}
                  className={cn(
                    "w-full rounded-md px-3 py-2 text-left text-sm transition-colors",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    current
                      ? "bg-accent font-medium text-accent-foreground"
                      : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
                  )}
                >
                  {category.label}
                </button>
              </li>
            );
          })}
        </ul>
      </nav>

      <div className="settings-plain flex min-w-0 flex-col gap-7 lg:gap-0">
        {categories.map((category) => {
          const current = category.id === selected?.id;
          return (
            <div
              key={category.id}
              data-category={category.id}
              data-selected={current ? "true" : "false"}
              className={cn(
                // Security closes the single column, set apart from the rest.
                category.id === "security" && "pt-4 lg:pt-0",
                !current && "lg:hidden",
              )}
            >
              {category.content}
            </div>
          );
        })}
      </div>
    </div>
  );
}
