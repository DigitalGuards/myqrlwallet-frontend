import { NATIVE_TOKEN } from "@/constants";
import { utils } from "@theqrl/web3";
import { BigNumber } from "bignumber.js";

/**
 * Safely format a raw planck transaction `value` into a "X QRL" string.
 * The value originates from a dApp (qrl_sendTransaction / qrl_signTransaction)
 * and is NOT schema-validated, so it may be non-numeric, negative, or a
 * fractional number. A bare `BigInt(value)` would throw during render and
 * crash the approval modal, leaving the user unable to even reject the
 * request. Falls back to a safe label instead of throwing.
 */
export const formatQuantaValue = (value: unknown): string => {
    if (value === undefined || value === null || value === "") return "0 QRL";
    try {
        const planck = BigInt(value as string);
        if (planck < 0n) return "invalid value";
        return `${utils.fromPlanck(planck.toString(), "quanta")} QRL`;
    } catch {
        return "invalid value";
    }
};

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
    includeSymbol: boolean = true,
) => {
    const symbol = tokenSymbol ?? NATIVE_TOKEN.symbol;
    try {
        const bigNumber = new BigNumber(balance);
        if (bigNumber.isNaN() || bigNumber.isZero()) {
            return includeSymbol ? `0.0 ${symbol}` : "0.0";
        }

        let formatted = bigNumber
            .toFormat(4, BigNumber.ROUND_DOWN)
            .replace(/\.?0+$/, "");

        if (!formatted.includes(".")) {
            formatted += ".0";
        }

        return includeSymbol ? `${formatted} ${symbol}` : formatted;
    } catch {
        return includeSymbol ? `0.0 ${symbol}` : "0.0";
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
