import { NATIVE_TOKEN } from "@/constants";
import { BigNumber } from "bignumber.js";

BigNumber.config({
    DECIMAL_PLACES: 18,
    EXPONENTIAL_AT: 1e9,
    ROUNDING_MODE: BigNumber.ROUND_DOWN,
    FORMAT: {
        decimalSeparator: ".",
        groupSeparator: ",",
        groupSize: 3,
    },
});

export const getOptimalGasFee = (gas: string, tokenSymbol?: string) => {
    const symbol = tokenSymbol ?? "QRL";
    try {
        if (Number(gas) == 0) return `0.0 ${symbol}`;
        const precisionFloat = parseFloat(Number(gas).toString()).toFixed(16);

        let postDecimalString = precisionFloat.substring(
            precisionFloat.indexOf(".") + 1,
        );
        let i = 0;
        while (i < postDecimalString.length && postDecimalString[i] === "0") {
            i++;
        }
        postDecimalString = postDecimalString.substring(0, i + 4);

        // Remove trailing zeros
        while (postDecimalString.endsWith("0")) {
            postDecimalString = postDecimalString.slice(0, -1);
        }

        if (postDecimalString === "") {
            return `${precisionFloat.substring(0, precisionFloat.indexOf("."))} ${symbol}`;
        }

        return `${precisionFloat.substring(0, precisionFloat.indexOf(".") + 1).concat(postDecimalString)} ${symbol}`;
    } catch (_error) {
        return `${gas} ${symbol}`;
    }
};

export const getOptimalTokenBalance = (
    balance: string,
    tokenSymbol?: string,
) => {
    const symbol = tokenSymbol ?? NATIVE_TOKEN.symbol;
    try {
        const bigNumber = new BigNumber(balance);
        if (bigNumber.isNaN() || bigNumber.isZero()) return `0.0 ${symbol}`;

        let formatted = bigNumber
            .toFormat(4, BigNumber.ROUND_DOWN)
            .replace(/\.?0+$/, "");

        if (!formatted.includes(".")) {
            formatted += ".0";
        }

        return `${formatted} ${symbol}`;
    } catch {
        return `0.0 ${symbol}`;
    }
};

export const formatBalance = (
    balance: string | number,
    decimals: number = 2,
    useThousandSeparator: boolean = true
): string => {
    const bn = new BigNumber(balance);

    if (bn.isNaN()) return '0';

    let formatted = bn.toFixed(decimals, BigNumber.ROUND_DOWN);

    // If a non-zero balance rounds to zero at the requested precision,
    // expand precision so small amounts aren't misleadingly shown as 0.
    if (!bn.isZero() && new BigNumber(formatted).isZero()) {
        formatted = bn
            .toFixed(18, BigNumber.ROUND_DOWN)
            .replace(/0+$/, '')
            .replace(/\.$/, '');
    }

    if (useThousandSeparator) {
        const parts = formatted.split('.');
        parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
        formatted = parts.join('.');
    }

    return formatted;
};
