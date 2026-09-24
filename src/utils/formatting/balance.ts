import { NATIVE_TOKEN } from "@/constants";
import { utils } from "@theqrl/web3";
import { BigNumber } from "bignumber.js";

/**
 * Safely format a raw planck transaction `value` into a "X Quanta" string.
 * Relay requests are validated before approval, while this defensive parser
 * also protects direct/internal callers from crashing the review render.
 */
export const formatQuantaValue = (value: unknown): string => {
    if (value === undefined || value === null || value === "") return `0 ${NATIVE_TOKEN.symbol}`;
    try {
        const planck = BigInt(value as string);
        if (planck < 0n) return "invalid value";
        return `${utils.fromPlanck(planck.toString(), "quanta")} ${NATIVE_TOKEN.symbol}`;
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
    const symbol = tokenSymbol ?? NATIVE_TOKEN.symbol;
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

/**
 * Display rule for a native account balance, shared with the browser
 * extension (myqrlwallet-extension `src/functions/formatBalance.ts`). Both
 * surfaces must render the same account at the same width, so keep the two
 * in step.
 *
 * The rule:
 *   1. Thousands are grouped with commas.
 *   2. A balance of 1 or more shows exactly `decimals` (default 2) fraction
 *      digits, padded with zeros: 40500 renders as "40,500.00".
 *   3. A balance below 1 gets up to 6 fraction digits so 0.249 is not
 *      truncated to 0.24, then trailing zeros beyond the 2nd digit are
 *      dropped: 0.240000 renders as "0.24", 0.249000 as "0.249".
 *   4. A non-zero balance that still rounds to zero at 6 digits falls back to
 *      its first 4 significant digits, so dust never reads as "0.00".
 *   5. Truncation is always toward zero, so no balance is ever shown larger
 *      than it is.
 *
 * Token balances keep `getOptimalTokenBalance`, which trims trailing zeros,
 * because token decimals vary.
 */
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
        // precision, so fall back to the first ~4 significant digits.
        formatted = bn.precision(4, BigNumber.ROUND_DOWN).toString();
    } else if (effectiveDecimals > decimals) {
        // Strip trailing zeros beyond the requested minimum decimal count
        // (e.g. 0.240000 → 0.24, 0.249000 → 0.249).
        const trimRe = new RegExp(`(\\.\\d{${decimals}}\\d*?)0+$`);
        formatted = formatted.replace(trimRe, '$1');
    }

    if (useThousandSeparator) {
        const parts = formatted.split('.');
        parts[0] = (parts[0] ?? '').replace(/\B(?=(\d{3})+(?!\d))/g, ',');
        formatted = parts.join('.');
    }

    return formatted;
};
