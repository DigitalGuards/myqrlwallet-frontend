import { cva } from "class-variance-authority";

type HexSeedListingProps = {
    hexSeed: string;
    className?: string;
};

const hexSeedListingClasses = cva(
    "rounded-lg border border-primary/15 bg-foreground/[0.04] p-4 font-data text-sm break-all",
);

export const HexSeedListing = ({ hexSeed, className }: HexSeedListingProps) => {
    return (
        <div className={hexSeedListingClasses({ className })}>
            {hexSeed}
        </div>
    );
};
