import { useStore } from "@/stores/store";
import { utils } from "@theqrl/web3";
import { cva } from "class-variance-authority";
import { Loader } from "lucide-react";
import { useEffect, useState, useRef } from "react";
import { getOptimalGasFee } from "@/utils/formatting";

type GasFeeNoticeProps = {
  from: string;
  to: string;
  value: number;
  isSubmitting: boolean;
};

const gasFeeNoticeClasses = cva(
  "m-1 flex justify-around rounded-lg border border-white px-4 py-2",
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
}: GasFeeNoticeProps) => {
  const { zondStore } = useStore();
  const { zondInstance } = zondStore;
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
        value: utils.toWei(value, "ether"),
      };
      const estimatedTransactionGas =
        (await zondInstance?.estimateGas(transaction)) ?? BigInt(0);
      const gasPrice = (await zondInstance?.getGasPrice()) ?? BigInt(0);
      const estimatedGasRaw = utils.fromWei(
        BigInt(estimatedTransactionGas) * BigInt(gasPrice),
        "ether"
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
  }, [from, to, value, hasValuesForGasCalculation]);

  return (
    hasValuesForGasCalculation && (
      <div className={gasFeeNoticeClasses({ isSubmitting })}>
        {gasFee.isLoading ? (
          <div className="flex gap-2">
            <Loader className="h-4 w-4 animate-spin" />
            Estimating gas fee
          </div>
        ) : gasFee.error ? (
          <div>{gasFee.error}</div>
        ) : (
          <div className="w-full overflow-hidden">
            Estimated gas fee is {gasFee?.estimatedGas.toString()}
          </div>
        )}
      </div>
    )
  );
};
