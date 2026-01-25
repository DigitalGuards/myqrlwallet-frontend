import { cva } from "class-variance-authority";

type HexSeedListingProps = {
    hexSeed: string;
    className?: string;
};

const hexSeedListingClasses = cva(
    "rounded-lg border border-input bg-muted p-4 font-mono text-sm break-all",
);

export const HexSeedListing = ({ hexSeed, className }: HexSeedListingProps) => {
    return (
        <div className={hexSeedListingClasses({ className })}>
            {hexSeed}
        </div>
    );
};
