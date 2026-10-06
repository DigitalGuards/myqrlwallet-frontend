import { useStore } from "@/stores/store";
import { quoteFees, type FeeLevel } from "@/stores/qrlStore";
import type { ApprovedFee } from "@/utils/web3/feePolicy";
import { utils } from "@theqrl/web3";
import { cva } from "class-variance-authority";
import { Loader } from "lucide-react";
import { useEffect, useState, useRef } from "react";
import { getOptimalGasFee } from "@/utils/formatting";
import { cn } from "@/utils/cn";

const FEE_DISPLAY: Record<FeeLevel, { label: string }> = {
  low:    { label: "Slow" },
  medium: { label: "Medium" },
  high:   { label: "Fast" },
};

type GasFeeNoticeProps = {
  from: string;
  to: string;
  value: string;
  isSubmitting: boolean;
  feeLevel: FeeLevel;
  onFeeLevelChange: (level: FeeLevel) => void;
  /**
   * The quote behind the figure on screen, with the gas limit it was computed
   * with. The send passes both back, so signing can neither use a more
   * expensive price nor quietly grow the gas side of the same product.
   */
  onQuote?: (approved: ApprovedFee | null) => void;
};

const gasFeeNoticeClasses = cva(
  "mt-4 flex flex-col gap-3 rounded-md border border-border bg-muted/30 px-4 py-3.5",
  {
    variants: {
      isSubmitting: {
        true: ["opacity-50"],
        false: ["opacity-100"],
      },
    },
    defaultVariants: {
      isSubmitting: false,
    },
  }
);

export const GasFeeNotice = ({
  from,
  to,
  value,
  isSubmitting,
  feeLevel,
  onFeeLevelChange,
  onQuote,
}: GasFeeNoticeProps) => {
  const { qrlStore } = useStore();
  const { qrlInstance } = qrlStore;
  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null);

  const hasValuesForGasCalculation = !!from && !!to && !!value;

  const [gasFee, setGasFee] = useState({
    estimatedGas: "",
    isLoading: true,
    error: "",
  });

  // Kept in a ref so a new callback identity does not re-run the quote.
  const onQuoteRef = useRef(onQuote);
  useEffect(() => {
    onQuoteRef.current = onQuote;
  }, [onQuote]);

  const fetchGasFee = async () => {
    setGasFee(prev => ({ ...prev, isLoading: true, error: "" }));
    onQuoteRef.current?.(null);
    try {
      const transaction = {
        from,
        to,
        value: utils.toPlanck(value, "quanta"),
      };
      if (!qrlInstance) throw new Error("Wallet not connected");
      const [estimatedTransactionGas, fees] = await Promise.all([
        qrlInstance.estimateGas(transaction),
        quoteFees(qrlInstance, feeLevel),
      ]);
      // Quote what the send is expected to cost at the current base fee;
      // maxFeePerGas is only a ceiling and its unused part is refunded.
      const estimatedGasRaw = utils.fromPlanck(
        BigInt(estimatedTransactionGas) * fees.expectedFeePerGas,
        "quanta"
      );
      const estimatedGas = getOptimalGasFee(estimatedGasRaw);
      setGasFee(prev => ({ ...prev, estimatedGas, error: "", isLoading: false }));
      onQuoteRef.current?.({
        quote: fees,
        gasLimit: BigInt(estimatedTransactionGas),
      });
    } catch (error) {
      onQuoteRef.current?.(null);
      setGasFee(prev => ({ ...prev, error: `${error}`, isLoading: false }));
    }
  };

  useEffect(() => {
    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }

    if (hasValuesForGasCalculation) {
      debounceTimerRef.current = setTimeout(() => {
        fetchGasFee();
      }, 500);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [from, to, value, feeLevel, hasValuesForGasCalculation]);

  return (
    <div className={gasFeeNoticeClasses({ isSubmitting })}>
        <div className="flex items-center justify-between text-sm text-muted-foreground">
          <span className="font-medium">Network fee</span>
          {!hasValuesForGasCalculation ? (
            <span className="text-xs text-muted-foreground/70">
              Enter recipient and amount to estimate
            </span>
          ) : gasFee.isLoading ? (
            <span className="flex items-center gap-2">
              <Loader className="h-4 w-4 animate-spin" />
              Estimating fee...
            </span>
          ) : gasFee.error ? (
            <span className="text-destructive">{gasFee.error}</span>
          ) : (
            <span className="font-numeric text-foreground">≈ {gasFee.estimatedGas}</span>
          )}
        </div>
        <div className="grid grid-cols-3 gap-2">
          {(["low", "medium", "high"] as FeeLevel[]).map((level) => {
            const active = feeLevel === level;
            return (
              <button
                key={level}
                type="button"
                onClick={() => onFeeLevelChange(level)}
                disabled={isSubmitting}
                aria-pressed={active}
                className={cn(
                  "rounded-sm border py-2 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50",
                  active
                    ? "border-secondary bg-secondary/10 text-secondary"
                    : "border-input bg-background text-muted-foreground hover:text-foreground",
                )}
              >
                {FEE_DISPLAY[level].label}
              </button>
            );
          })}
        </div>
    </div>
  );
};
