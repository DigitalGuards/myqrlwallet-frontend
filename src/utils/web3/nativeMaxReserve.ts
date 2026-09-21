import { formatUnits, parseUnits } from "./units";

/** Bootstrap with one base unit, then verify Max under the signer's fee policy. */
export async function nativeMaxReserve(
  balance: string,
  estimateFee: (value: string) => Promise<string>,
): Promise<string> {
  const available = parseUnits(balance, 18);
  if (available <= 0n) throw new Error("No balance available for transfer");
  let reserve = 0n;
  for (let attempt = 0; attempt < 3; attempt++) {
    const fee = parseUnits(
      await estimateFee(
        formatUnits(attempt === 0 ? 1n : available - reserve, 18),
      ),
      18,
    );
    if (fee < 0n || fee >= available)
      throw new Error("Insufficient balance for transfer fees");
    if (attempt > 0 && fee <= reserve) return formatUnits(reserve, 18);
    reserve = fee;
  }
  throw new Error("Transfer fee quote changed; enter an amount manually");
}
