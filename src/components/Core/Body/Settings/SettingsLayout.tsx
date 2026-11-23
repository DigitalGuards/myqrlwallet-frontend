import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FocusEvent,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@/utils/cn";
import { readSelectedCategory, saveSelectedCategory } from "./selectedCategory";
import { useSettingsBusy } from "./settingsBusyContext";

export type SettingsCategory = {
  id: string;
  label: string;
  content: ReactNode;
};

/** Tailwind's lg breakpoint. */
const WIDE_QUERY = "(min-width: 64rem)";

function wideQuery(): MediaQueryList | null {
  return typeof window.matchMedia === "function"
    ? window.matchMedia(WIDE_QUERY)
    : null;
}

/** How long after a focus loss it still counts as where the user was. */
const FOCUS_MEMORY_MS = 500;

const tabId = (id: string) => `settings-tab-${id}`;
const panelId = (id: string) => `settings-panel-${id}`;

/**
 * One settings page for every width. Every category is rendered once.
 *
 * Below lg the categories stack as ordinary labelled sections in one column,
 * in order, and the category list is hidden. From lg up the list shows on the
 * left as vertical tabs and only the selected category is displayed on the
 * right, as the tab's panel. The switch is CSS only, so a resize across the
 * breakpoint cannot remount a section: an open Change PIN panel, typed input
 * and form state stay as they are. Categories that are not selected are
 * display:none at lg, which also removes them from the accessibility tree and
 * the tab order.
 *
 * Crossing into lg selects the category the user was working in. While an
 * operation runs the list stays put, and an alert or status message that
 * appears in a hidden category brings that category up.
 */
export function SettingsLayout({
  categories,
  requested,
  pending = false,
}: {
  categories: SettingsCategory[];
  /** A category asked for by the navigation that opened Settings. */
  requested?: string | undefined;
  /** True until every category is known; holds the fallback selection. */
  pending?: boolean;
}) {
  const { t } = useTranslation("common");
  const { busy } = useSettingsBusy();
  const [stored, setStored] = useState<string | null>(() =>
    requested && categories.some((category) => category.id === requested)
      ? requested
      : readSelectedCategory(),
  );
  const [wide, setWide] = useState(() => wideQuery()?.matches ?? false);
  const tabRefs = useRef(new Map<string, HTMLButtonElement>());
  const paneRefs = useRef(new Map<string, HTMLElement>());
  const panesRef = useRef<HTMLDivElement>(null);
  const lastFocus = useRef<{ id: string; at: number } | null>(null);

  const selected =
    categories.find((category) => category.id === stored) ??
    (pending ? undefined : categories[0]);

  const choose = useCallback((id: string) => {
    setStored(id);
  }, []);

  // The selection is remembered for the session.
  useEffect(() => {
    if (stored) saveSelectedCategory(stored);
  }, [stored]);

  // A navigation that names a category (a deep link) selects it. Adjusting
  // state while rendering avoids a second render pass in an effect.
  const [seenRequest, setSeenRequest] = useState(requested);
  if (requested !== seenRequest) {
    setSeenRequest(requested);
    if (requested && categories.some((category) => category.id === requested)) {
      setStored(requested);
    }
  }

  // The latest values, for listeners that are attached once.
  const latest = useRef({ categories, selected, wide, stored });
  useEffect(() => {
    latest.current = { categories, selected, wide, stored };
  });

  const categoryOf = useCallback((node: Node | null): string | undefined => {
    if (!node) return undefined;
    return latest.current.categories.find((category) =>
      paneRefs.current.get(category.id)?.contains(node),
    )?.id;
  }, []);

  // Crossing to lg: keep the pane in use on screen.
  useEffect(() => {
    const query = wideQuery();
    if (!query) return;
    const onChange = () => {
      setWide(query.matches);
      if (!query.matches) return;
      const { categories: all, stored: current } = latest.current;
      let target = categoryOf(document.activeElement);
      const recent = lastFocus.current;
      if (!target && recent && Date.now() - recent.at < FOCUS_MEMORY_MS) {
        target = recent.id;
      }
      if (!target) {
        const open = all.filter((category) =>
          paneRefs.current
            .get(category.id)
            ?.querySelector('[aria-expanded="true"]'),
        );
        target = open.find((category) => category.id === current)?.id ?? open[0]?.id;
      }
      if (target) choose(target);
    };
    query.addEventListener("change", onChange);
    return () => {
      query.removeEventListener("change", onChange);
    };
  }, [choose, categoryOf]);

  // A message that appears in a category that is not shown brings it up.
  useEffect(() => {
    const root = panesRef.current;
    if (!root) return;
    const observer = new MutationObserver((records) => {
      const { wide: isWide, selected: current } = latest.current;
      if (!isWide) return;
      for (const record of records) {
        for (const node of record.addedNodes) {
          if (!(node instanceof Element)) continue;
          const message = node.matches('[role="alert"], [role="status"]')
            ? node
            : node.querySelector('[role="alert"], [role="status"]');
          if (!message) continue;
          const id = categoryOf(message);
          if (id && id !== current?.id) choose(id);
        }
      }
    });
    observer.observe(root, { childList: true, subtree: true });
    return () => {
      observer.disconnect();
    };
  }, [choose, categoryOf]);

  const select = (index: number, focus: boolean) => {
    const target = categories[index];
    if (!target) return;
    if (busy && target.id !== selected?.id) return;
    choose(target.id);
    if (focus) tabRefs.current.get(target.id)?.focus();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.ctrlKey || event.metaKey || event.altKey) return;
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

  const rememberFocusLoss = (event: FocusEvent<HTMLDivElement>) => {
    const id = categoryOf(event.target);
    if (id) lastFocus.current = { id, at: Date.now() };
  };

  return (
    <div className="lg:grid lg:grid-cols-[13rem_minmax(0,1fr)] lg:gap-10">
      <div
        role="tablist"
        aria-orientation="vertical"
        aria-label={t("settings")}
        className="hidden space-y-0.5 lg:block"
        onKeyDown={onKeyDown}
      >
        {categories.map((category, index) => {
          const current = category.id === selected?.id;
          const tabbable = current || (!selected && index === 0);
          return (
            <button
              key={category.id}
              type="button"
              role="tab"
              id={tabId(category.id)}
              ref={(element) => {
                if (element) tabRefs.current.set(category.id, element);
                else tabRefs.current.delete(category.id);
              }}
              aria-selected={current}
              aria-controls={panelId(category.id)}
              aria-disabled={busy && !current ? true : undefined}
              tabIndex={tabbable ? 0 : -1}
              onClick={() => {
                select(index, false);
              }}
              className={cn(
                "block w-full rounded-md px-3 py-2 text-left text-sm transition-colors",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                busy && !current && "cursor-not-allowed opacity-50",
                current
                  ? "bg-accent font-medium text-accent-foreground"
                  : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
              )}
            >
              {category.label}
            </button>
          );
        })}
      </div>

      <div
        ref={panesRef}
        className="settings-plain flex min-w-0 flex-col gap-7 lg:gap-0"
        onBlur={rememberFocusLoss}
      >
        {categories.map((category) => {
          const current = category.id === selected?.id;
          return (
            <div
              key={category.id}
              id={panelId(category.id)}
              ref={(element) => {
                if (element) paneRefs.current.set(category.id, element);
                else paneRefs.current.delete(category.id);
              }}
              role={wide ? "tabpanel" : undefined}
              aria-labelledby={wide ? tabId(category.id) : undefined}
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
