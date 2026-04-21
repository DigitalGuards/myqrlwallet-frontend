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

    // Sub-unit balances get up to 6 decimals so values like 0.249 aren't
    // truncated to 0.24; trailing zeros are stripped below.
    const subUnit = bn.abs().lt(1);
    const effectiveDecimals = subUnit ? Math.max(decimals, 6) : decimals;

    let formatted = bn.toFixed(effectiveDecimals, BigNumber.ROUND_DOWN);

    if (!bn.isZero() && parseFloat(formatted) === 0) {
        // Balance is non-zero but rounds to zero even at the expanded
        // precision — fall back to the first ~4 significant digits.
        formatted = bn.precision(4, BigNumber.ROUND_DOWN).toString();
    } else if (effectiveDecimals > decimals) {
        // Strip trailing zeros beyond the requested minimum decimal count
        // (e.g. 0.240000 → 0.24, 0.249000 → 0.249).
        const trimRe = new RegExp(`(\\.\\d{${decimals}}\\d*?)0+$`);
        formatted = formatted.replace(trimRe, '$1');
    }

    if (useThousandSeparator) {
        const parts = formatted.split('.');
        parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
        formatted = parts.join('.');
    }

    return formatted;
};
