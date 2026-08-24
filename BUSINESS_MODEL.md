# Business Model

> **Status: revenue is currently ZERO.** The fee switch exists and is set to
> `0 bps`. Nothing below is live yet.

---

## Where Novaire can earn

| # | Source | Mechanism | Status |
|---|---|---|---|
| 1 | **Swap fee share** | `fee_bps` (10 = 0.10%) is charged per trade. `set_protocol_fee(share_bps, treasury)` routes a share of **that fee** to the treasury. Capped at **50%**, so LPs always keep the majority. | ✅ built, set to 0 |
| 2 | **YT yield fee** | A cut of yield claimed by YT holders, before it leaves escrow. | ❌ not built |
| 3 | **Market creation** | Fee to list a new maturity/asset. | ❌ needs a factory |

**Critically: the fee is a share of the fee, never of the trade.**

```
trade 1,000 → fee 1.00 (10 bps) → protocol takes 30% of 1.00 = 0.30
                                → LPs keep                   = 0.70
protocol take = 0.03% of volume
```

### What that earns

At `fee_bps = 10` and a 30% protocol share = **3 bps of volume**:

| Daily volume | Protocol/yr | LPs/yr |
|---|---|---|
| $100k | $11k | $26k |
| $1M | $110k | $255k |
| $10M | $1.1M | $2.6M |

**Reality check:** the pool currently holds ~40 units. A 4-unit order saturates
the curve. Every number above assumes liquidity that does not yet exist — that
is a capital problem, not a code one.

---

## Versus comparable protocols

| | **Novaire** | **Pendle** (EVM) | **Spectra** (EVM) | **Exactly** (EVM) | **Sudo/Nostra** (Starknet) |
|---|---|---|---|---|---|
| Chain | Stellar / Soroban | Ethereum, Arbitrum, BNB… | Ethereum, Arbitrum | Optimism, Base | Starknet |
| Model | SY → PT + YT, YieldSpace AMM | Same (the original) | Pendle-style, permissionless | Fixed/variable lending pools | Lending + fixed rate |
| Swap fee | **0.10%** | ~0.05–0.30%, per-market | per-market | n/a (lending spread) | lending spread |
| Protocol cut of swap fee | **0% (switch at 0, cap 50%)** | 20% → veToken holders | share → veSPECTRA | reserve factor | reserve factor |
| Cut of YT yield | **none** | **3% of accrued yield** | none | n/a | n/a |
| Market creation | admin only, 1 market | permissionless | permissionless | governed | governed |
| Token / ve-model | **none** | vePENDLE (fee share + gauges) | veSPECTRA | esEXA | yes |
| TVL scale | **~40 units (testnet)** | ~$2–5B | ~$50M | ~$100M | ~$100M |

### What the comparison says

1. **Pendle's real revenue is the 3% YT yield fee, not swap fees.** It accrues
   on TVL continuously rather than on trading activity, which is far more stable.
   Novaire has no equivalent and should build one before chasing volume.
2. **Everyone monetises through a ve-token.** Fees flow to lockers, which buys
   loyal liquidity. Novaire has no token and no gauge system — so no mechanism to
   attract the liquidity every number above depends on.
3. **Permissionless market creation is the growth engine.** Pendle and Spectra
   both let anyone list a maturity. Novaire is admin-only and single-market,
   which caps addressable volume at whatever one market can carry.
4. **The genuine wedge is being first on Stellar.** No Pendle-equivalent exists
   in the Soroban ecosystem, and Blend is the natural yield source. That is a
   real position — but it is a distribution advantage, not a revenue model.

---

## Honest assessment

**Working:** the fee mechanism is built, capped, and treasury-authorized so a
compromised admin cannot redirect accrued fees.

**Missing, in order of impact:**

1. **YT yield fee** — the thing that actually pays Pendle's bills
2. **Liquidity** — every projection is fiction until the pool can absorb real size
3. **Factory / rolling maturities** — one market caps the whole business
4. **A token or incentive mechanism** — no way to buy liquidity without one
5. **LP tokens** — a prerequisite for #4; LP positions are currently bare storage entries

**Recommended first move:** add the YT yield fee (2–3%, matching Pendle) before
launch. It is TVL-based rather than volume-based, so it earns from day one
instead of waiting for trading depth you do not yet have. Doing it now also
avoids an upgrade later.
