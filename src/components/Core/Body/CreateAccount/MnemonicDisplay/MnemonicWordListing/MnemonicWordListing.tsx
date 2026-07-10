import { Card, CardContent } from "../../../../../UI/Card";

interface MnemonicWordListingProps {
  mnemonic: string;
}

const MnemonicWordListing = ({ mnemonic }: MnemonicWordListingProps) => {
  const mnemonicWords = mnemonic.trim().split(" ");

  return (
    mnemonicWords.length > 0 &&
    mnemonicWords[0] !== "" && (
      <Card>
        <CardContent className="grid grid-cols-2 gap-2 p-4 sm:grid-cols-3 md:grid-cols-4">
          {mnemonicWords.map((word, index) => (
            <div
              key={`${word}-${index}`}
              className="flex items-center gap-2 rounded-md border border-foreground/[0.07] bg-foreground/[0.04] px-2.5 py-1.5 text-sm font-data"
            >
              <span className="min-w-5 text-right text-xs text-primary/70">{index + 1}</span>
              <span className="text-foreground">{word}</span>
            </div>
          ))}
        </CardContent>
      </Card>
    )
  );
};

export default MnemonicWordListing;
