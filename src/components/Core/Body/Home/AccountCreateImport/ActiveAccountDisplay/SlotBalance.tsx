import { SlotDigit } from "./SlotDigit";

interface SlotBalanceProps {
  /** Formatted balance string, e.g. "1,234.56" */
  value: string;
  /** Whether the slot animation is active */
  spinning: boolean;
}

/**
 * Renders a balance string with slot-machine digit rolling animation.
 * Each digit gets a staggered delay so they cascade left-to-right.
 */
export const SlotBalance = ({ value, spinning }: SlotBalanceProps) => {
  const chars = value.split("");
  // Count only digits for delay staggering
  let digitIndex = 0;

  return (
    <span className="inline-flex">
      {chars.map((char, i) => {
        const isDigit = /\d/.test(char);
        const delay = isDigit ? digitIndex * 80 : 0;
        if (isDigit) digitIndex++;

        return (
          <SlotDigit
            key={`${i}-${char}`}
            target={char}
            spinning={spinning}
            delay={delay}
          />
        );
      })}
    </span>
  );
};
