import { StringUtil } from "@/utils/formatting";
import { cva } from "class-variance-authority";

type HexSeedListingProps = {
    hexSeed: string;
    className?: string;
};

const hexSeedListingClasses = cva(
    "grid grid-cols-3 gap-2 rounded-lg border border-input bg-muted p-4 font-mono text-sm sm:grid-cols-4 md:grid-cols-6",
);

export const HexSeedListing = ({ hexSeed, className }: HexSeedListingProps) => {
    const splitSeed = StringUtil.getSplitAddress(hexSeed, 6).split(" ");

    return (
        <div className={hexSeedListingClasses({ className })}>
            {splitSeed.map((chunk, index) => (
                <div key={index} className="text-center">
                    {chunk}
                </div>
            ))}
        </div>
    );
};
