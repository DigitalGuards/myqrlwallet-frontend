import type { ReactNode } from "react";

interface SettingsSectionProps {
    title: string;
    action?: ReactNode;
    /** id for the heading, so the section can be labelled by it. */
    headingId?: string;
    children: ReactNode;
}

/**
 * Plain section: a heading over rows separated by hairlines, no card. On wide
 * screens (lg) the heading doubles as the title of the selected settings
 * category, so it is larger there.
 */
export const SettingsSection = ({ title, action, headingId, children }: SettingsSectionProps) => (
    <section aria-labelledby={headingId}>
        <div className="mb-1 flex min-h-6 items-center justify-between lg:mb-2">
            <h2
                id={headingId}
                className="text-sm font-semibold text-foreground lg:text-lg lg:tracking-tight"
            >
                {title}
            </h2>
            {action}
        </div>
        <div className="divide-y divide-border border-y border-border">
            {children}
        </div>
    </section>
);

interface SettingsRowProps {
    title: string;
    subtitle?: string;
    /** Right-hand slot: Switch, chevron, value text, ... */
    right?: ReactNode;
    onClick?: () => void;
    disabled?: boolean;
    /** For disclosure rows: reflected as aria-expanded on the button. */
    ariaExpanded?: boolean;
    /** id of the element a disclosure row controls. */
    ariaControls?: string;
}

export const SettingsRow = ({
    title,
    subtitle,
    right,
    onClick,
    disabled,
    ariaExpanded,
    ariaControls,
}: SettingsRowProps) => {
    const content = (
        <>
            <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium">{title}</span>
                {subtitle && (
                    <span className="mt-0.5 block text-xs text-muted-foreground">
                        {subtitle}
                    </span>
                )}
            </span>
            {right}
        </>
    );

    if (onClick) {
        return (
            <button
                type="button"
                onClick={onClick}
                disabled={disabled}
                aria-expanded={ariaExpanded}
                aria-controls={ariaControls}
                className="-mx-2 flex w-[calc(100%+1rem)] items-center gap-3 rounded-sm px-2 py-3 text-left transition-colors hover:bg-foreground/[0.04] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
            >
                {content}
            </button>
        );
    }

    return <div className="flex w-full items-center gap-3 py-3">{content}</div>;
};
