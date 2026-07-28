import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { Card } from "../../../UI/Card";
import { cn } from "../../../../utils";

interface SettingsSectionProps {
    title: string;
    action?: ReactNode;
    children: ReactNode;
}

/**
 * Grouped-list section: a small muted label above a card whose direct
 * children are separated by hairline dividers (mirrors the mobile app's
 * Section/Row settings layout).
 */
export const SettingsSection = ({ title, action, children }: SettingsSectionProps) => (
    <section>
        <div className="mb-2 flex items-center justify-between px-1">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                {title}
            </h2>
            {action}
        </div>
        <Card className="overflow-hidden">
            <div className="divide-y divide-border/60">{children}</div>
        </Card>
    </section>
);

export const SettingsIconTile = ({ icon: Icon, tint }: { icon: LucideIcon; tint: string }) => (
    <span
        className={cn(
            "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg",
            tint,
        )}
    >
        <Icon className="h-4 w-4" />
    </span>
);

interface SettingsRowProps {
    icon: LucideIcon;
    /** Tailwind classes for the icon tile, e.g. "bg-primary/15 text-primary" */
    tint: string;
    title: string;
    subtitle?: string;
    /** Right-hand slot: Switch, chevron, value text, ... */
    right?: ReactNode;
    onClick?: () => void;
    disabled?: boolean;
}

export const SettingsRow = ({
    icon,
    tint,
    title,
    subtitle,
    right,
    onClick,
    disabled,
}: SettingsRowProps) => {
    const content = (
        <>
            <SettingsIconTile icon={icon} tint={tint} />
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
                className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-foreground/[0.04] disabled:cursor-not-allowed disabled:opacity-50"
            >
                {content}
            </button>
        );
    }

    return <div className="flex w-full items-center gap-3 px-4 py-3">{content}</div>;
};
