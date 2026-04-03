import { useStore } from "@/stores/store";
import { FeeLevel } from "@/stores/qrlStore";
import { utils } from "@theqrl/web3";
import { cva } from "class-variance-authority";
import { Loader, Fuel } from "lucide-react";
import { useEffect, useState, useRef } from "react";
import { getOptimalGasFee } from "@/utils/formatting";
import { Button } from "@/components/UI/Button";

const FEE_DISPLAY: Record<FeeLevel, { label: string; multiplier: number }> = {
  low:    { label: "Low",    multiplier: 1 },
  medium: { label: "Medium", multiplier: 1.5 },
  high:   { label: "High",   multiplier: 2 },
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
  "m-1 flex flex-col gap-3 rounded-lg border border-white px-4 py-3",
  {
    variants: {
      isSubmitting: {
        true: ["opacity-30"],
        false: ["opacity-80"],
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
      const multiplied = BigInt(Math.round(Number(gasPrice) * FEE_DISPLAY[feeLevel].multiplier));
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
    hasValuesForGasCalculation && (
      <div className={gasFeeNoticeClasses({ isSubmitting })}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Fuel className="h-4 w-4" />
            {gasFee.isLoading ? (
              <div className="flex gap-2">
                <Loader className="h-4 w-4 animate-spin" />
                Estimating fee...
              </div>
            ) : gasFee.error ? (
              <span className="text-sm">{gasFee.error}</span>
            ) : (
              <span className="text-sm">~{gasFee.estimatedGas} QRL</span>
            )}
          </div>
        </div>
        <div className="flex gap-2">
          {(["low", "medium", "high"] as FeeLevel[]).map((level) => (
            <Button
              key={level}
              type="button"
              variant={feeLevel === level ? "default" : "outline"}
              size="sm"
              onClick={() => onFeeLevelChange(level)}
              disabled={isSubmitting}
              className="flex-1"
            >
              {FEE_DISPLAY[level].label}
            </Button>
          ))}
        </div>
      </div>
    )
  );
};
