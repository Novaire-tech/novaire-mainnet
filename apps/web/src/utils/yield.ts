/**
 * Calculates the projected daily yield in USD (or any single currency) from a
 * principal amount and an annual percentage yield.
 *
 * Formula: dailyYield = principal * (apyPct / 100) / 365
 *
 * This is an ESTIMATE derived from the current market-implied APY, not
 * realized or accrued yield.
 *
 * @param principal The current invested principal.
 * @param apyPct The annual percentage yield, expressed as a percentage (e.g. 5.2 for 5.2%).
 * @returns The projected daily yield. Returns 0 for any non-finite, NaN, or negative input.
 */
export function calculateProjectedDailyYield(principal: number, apyPct: number): number {
  if (!isFinite(principal) || isNaN(principal) || principal <= 0) return 0;
  if (!isFinite(apyPct) || isNaN(apyPct) || apyPct <= 0) return 0;

  const dailyYield = (principal * (apyPct / 100)) / 365;

  return isFinite(dailyYield) && !isNaN(dailyYield) ? dailyYield : 0;
}
