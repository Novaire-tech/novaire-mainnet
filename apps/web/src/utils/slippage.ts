export function applySlippage(amountOut: bigint, slippagePercent: number): bigint {
  const bps = BigInt(Math.floor((100 - slippagePercent) * 100));
  return (amountOut * bps) / 10000n;
}
