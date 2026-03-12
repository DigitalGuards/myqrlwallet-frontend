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
        <CardContent className="grid grid-cols-3 gap-4 p-6 sm:grid-cols-4">
          {mnemonicWords.map((word, index) => (
            <div
              key={`${word}-${index}`}
              className="flex items-center gap-2 text-sm"
            >
              <span className="text-muted-foreground">{index + 1}.</span>
              <span>{word}</span>
            </div>
          ))}
        </CardContent>
      </Card>
    )
  );
};

export default MnemonicWordListing;
