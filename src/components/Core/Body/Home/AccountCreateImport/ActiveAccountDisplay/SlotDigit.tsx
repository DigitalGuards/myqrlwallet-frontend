import { useCallback, useEffect, useState } from "react";

const DIGIT_HEIGHT = 32; // px – matches text-xl line height
const DIGITS = "0123456789";

interface SlotDigitProps {
  /** The target character to land on (digit, comma, period, etc.) */
  target: string;
  /** Whether to animate */
  spinning: boolean;
  /** Stagger delay in ms so digits don't all land at once */
  delay: number;
}

/**
 * A single slot-machine digit column.
 * Non-digit characters (comma, period) render statically.
 */
export const SlotDigit = ({ target, spinning, delay }: SlotDigitProps) => {
  const isDigit = /\d/.test(target);
  const [offset, setOffset] = useState(0);

  const spinDuration = 600; // ms of actual spinning after delay

  const runAnimation = useCallback(() => {
    const start = performance.now();
    let cancelled = false;

    const animate = (now: number) => {
      if (cancelled) return;
      const elapsed = now - start;
      const progress = Math.min(elapsed / spinDuration, 1);

      // Easing: fast start, smooth deceleration (ease-out cubic)
      const eased = 1 - Math.pow(1 - progress, 3);

      // Spin through several full cycles + land on target
      const targetIdx = parseInt(target);
      const totalTravel = 3 * 10 + targetIdx; // 3 full loops + target position
      const currentPos = eased * totalTravel;
      setOffset(-(currentPos % 10) * DIGIT_HEIGHT);

      if (progress < 1) {
        requestAnimationFrame(animate);
      } else {
        setOffset(-targetIdx * DIGIT_HEIGHT);
      }
    };

    requestAnimationFrame(animate);

    return () => { cancelled = true; };
  }, [target]);

  useEffect(() => {
    if (!spinning || !isDigit) return;

    const delayTimer = setTimeout(() => {
      const cancelAnimation = runAnimation();
      cleanupRef = cancelAnimation;
    }, delay);

    let cleanupRef: (() => void) | undefined;

    return () => {
      clearTimeout(delayTimer);
      cleanupRef?.();
    };
  }, [spinning, target, delay, isDigit, runAnimation]);

  // Static characters (comma, period, space)
  if (!isDigit) {
    return (
      <span className="inline-block" style={{ height: DIGIT_HEIGHT, lineHeight: `${DIGIT_HEIGHT}px` }}>
        {target}
      </span>
    );
  }

  // When not spinning, show static digit
  if (!spinning) {
    return (
      <span className="inline-block" style={{ height: DIGIT_HEIGHT, lineHeight: `${DIGIT_HEIGHT}px` }}>
        {target}
      </span>
    );
  }

  return (
    <span
      className="inline-block overflow-hidden align-bottom"
      style={{ height: DIGIT_HEIGHT, width: "0.6em" }}
    >
      <span
        className="inline-flex flex-col"
        style={{
          transform: `translateY(${offset}px)`,
          willChange: "transform",
        }}
      >
        {DIGITS.split("").map((d) => (
          <span
            key={d}
            className="block text-center"
            style={{ height: DIGIT_HEIGHT, lineHeight: `${DIGIT_HEIGHT}px` }}
          >
            {d}
          </span>
        ))}
      </span>
    </span>
  );
};
