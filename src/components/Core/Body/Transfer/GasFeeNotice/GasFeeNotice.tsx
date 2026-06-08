import { useStore } from "@/stores/store";
import type { FeeLevel } from "@/stores/qrlStore";
import { utils } from "@theqrl/web3";
import { cva } from "class-variance-authority";
import { Loader } from "lucide-react";
import { useEffect, useState, useRef } from "react";
import { getOptimalGasFee } from "@/utils/formatting";
import { cn } from "@/utils/cn";

const FEE_DISPLAY: Record<FeeLevel, { label: string; multiplier: number }> = {
  low:    { label: "Slow",   multiplier: 1 },
  medium: { label: "Medium", multiplier: 1.5 },
  high:   { label: "Fast",   multiplier: 2 },
};

type GasFeeNoticeProps = {
  from: string;
  to: string;
  value: number;
  isSubmitting: boolean;
  feeLevel: FeeLevel;
  onFeeLevelChange: (level: FeeLevel) => void;
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

  const fetchGasFee = async () => {
    setGasFee(prev => ({ ...prev, isLoading: true, error: "" }));
    try {
      const transaction = {
        from,
        to,
        value: utils.toPlanck(value, "quanta"),
      };
      const estimatedTransactionGas =
        (await qrlInstance?.estimateGas(transaction)) ?? BigInt(0);
      const gasPrice = (await qrlInstance?.getGasPrice()) ?? BigInt(0);
      const multiplied = (gasPrice * BigInt(Math.round(FEE_DISPLAY[feeLevel].multiplier * 100))) / BigInt(100);
      const estimatedGasRaw = utils.fromPlanck(
        BigInt(estimatedTransactionGas) * multiplied,
        "quanta"
      );
      const estimatedGas = getOptimalGasFee(estimatedGasRaw);
      setGasFee(prev => ({ ...prev, estimatedGas, error: "", isLoading: false }));
    } catch (error) {
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
            <span className="font-mono text-foreground">≈ {gasFee.estimatedGas}</span>
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
