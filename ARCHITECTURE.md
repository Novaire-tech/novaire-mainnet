# Architecture

Novaire is a Pendle-style yield-tokenization protocol on Stellar/Soroban. Users
deposit an asset, it earns in a Blend v2 lending pool, and that position is split
into a **fixed-rate** claim (PT) and a **variable-yield** claim (YT) which trade
against each other on a purpose-built AMM.

> Supersedes `docs/archive/ARCHITECTURE.superseded.md`, which described the
> pre-2026-08-13 10-contract system (`factory`, `vault`, `marketplace`,
> `maturity_engine`, `rollover`, `intent_engine`). None of those exist.

---

## 1. System topology

```mermaid
flowchart TB
    subgraph browser["Browser"]
        UI["Next.js app<br/>/app/mint · /app/trade · /app/portfolio"]
        FR["Freighter wallet<br/>(signs every tx)"]
        UI <--> FR
    end

    subgraph chain["Stellar · Soroban"]
        SY["<b>sy-wrapper</b><br/>custody + exchange rate<br/><i>the root oracle</i>"]
        TK["<b>tokenizer</b><br/>split · recombine<br/>redeem · claim_yield<br/><i>holds SY escrow</i>"]
        PT["<b>pt-token</b><br/>SEP-41"]
        YT["<b>yt-token</b><br/>SEP-41 + yield ledger"]
        AMM["<b>amm</b><br/>YieldSpace curve<br/>TWAP · flash routes"]
        BLEND[("Blend v2 pool<br/><i>external</i>")]

        SY <-->|supply / withdraw| BLEND
        TK -->|mint / burn| PT
        TK -->|mint / burn| YT
        TK <-->|escrow| SY
        AMM <-->|flash split/recombine| TK
        AMM -->|reads exchange_rate| SY
        TK -->|reads exchange_rate| SY
        YT -->|reads rate via tokenizer| TK
    end

    subgraph offchain["Off-chain"]
        IDX["indexer<br/>events → Postgres<br/>60s TVL/APY snapshots"]
        DB[("Postgres")]
        IDX --> DB
    end

    FR -->|signed txs| chain
    UI -->|read-only simulation| chain
    IDX -->|polls events| chain
    UI -->|/api/protocol-history| DB
```

**Every price in the system descends from one number:** `sy_wrapper.exchange_rate()`,
derived live as `blend_assets_under_management × 1e18 ÷ sy_supply`. There is no
stored rate and no setter — it moves only as the Blend position's value moves.

---

## 2. Money flow, end to end

```mermaid
flowchart LR
    W(["Wallet<br/>USDC / XLM"]) -->|1 deposit| SY["SY shares"]
    SY -->|supplied| B[("Blend v2<br/>b_rate ↑")]
    B -.->|interest accrues<br/>rate rises| SY

    SY -->|2 split| PTt["<b>PT</b><br/>principal"]
    SY -->|2 split| YTt["<b>YT</b><br/>yield claim"]

    PTt -->|3 trade| P((AMM))
    YTt -->|3 trade| P

    PTt -->|4a at maturity<br/>redeem_at_maturity| OUT(["Underlying<br/>back in wallet"])
    YTt -->|4b anytime<br/>claim_yield| OUT
    SY -->|4c redeem| OUT
```

**The invariant that makes it work:** `PT + YT = 1 unit of face`.

| | Costs today | Pays at maturity | You are betting |
|---|---|---|---|
| **PT** | ~0.96 | exactly 1.00 | rates *fall* — you locked ~21% fixed |
| **YT** | ~0.04 | all yield on 1.00 of face | rates *rise* above what's priced in |

Buying PT at 0.96 with 88 days left locks a fixed ~21.6% APY. Buying YT at 0.04
costs 4% of face and collects 100% of the yield on that face — roughly 25×
leverage on the variable rate.

---

## 3. What the UI does, screen by screen

```mermaid
flowchart TD
    A([Landing]) --> B[Connect Freighter]
    B --> C{Goal?}

    C -->|Fixed yield| D["/app/trade → Buy PT"]
    C -->|Lever the yield| E["/app/trade → Buy YT"]
    C -->|Hold both legs| F["/app/mint"]

    F --> F1["sig 1 · sy_wrapper.deposit"]
    F1 --> F2["sig 2 · tokenizer.split"]
    D --> D1["sig 1 · sy_wrapper.deposit"]
    D1 --> D2["sig 2 · amm.swap_sy_for_pt"]
    E --> E1["sig 1 · sy_wrapper.deposit"]
    E1 --> E2["sig 2 · amm.swap_sy_for_yt"]

    F2 --> G([Position held])
    D2 --> G
    E2 --> G

    G --> H["/app/portfolio"]
    H -->|anytime| I["tokenizer.claim_yield"]
    H -->|exit early| J["amm.swap_*_for_sy<br/>then sy_wrapper.redeem"]
    H -->|after maturity| K["tokenizer.redeem_at_maturity"]
    I --> G
    J --> L([Underlying])
    K --> L
```

### Buying YT — what actually happens on-chain

The AMM has no YT reserve. A YT purchase is synthesised in one transaction:

```mermaid
sequenceDiagram
    participant U as User
    participant A as amm
    participant T as tokenizer
    U->>A: swap_sy_for_yt(sy_in, min_yt_out)
    A->>A: solve largest affordable yt_out
    Note over A: charges only the curve cost,<br/>never the whole budget
    A->>T: split(pool SY)
    T-->>A: PT + YT minted
    A->>A: keep the PT (curve absorbs it)
    A->>U: send YT
    Note over A: PT/YT rounding dust stays<br/>in the pool as a matched pair
```

Selling YT is the mirror: the pool buys back the PT leg and `recombine`s the pair
into SY.

---

## 4. Maturity

```mermaid
flowchart LR
    M{{"maturity timestamp"}}
    M -->|before| A1["split · swap · add_liquidity<br/>all open"]
    M -->|at| F["rate frozen at the last<br/>observation ≤ maturity"]
    F -->|after| A2["swaps + split CLOSED<br/>redeem · claim · remove_liquidity OPEN"]
```

The freeze uses the last rate observed **at or before** maturity, never a live
read. Blend has no maturity concept and keeps accruing, so a live read would let
the *timing* of the first post-maturity call move value between PT and YT.

**PT is senior.** `claim_yield` reserves `ceil(pt_supply × WAD ÷ rate)` of escrow
for PT before paying any YT. If the rate regressed, shortfalls are priced
pro-rata at redemption rather than blocking it.

---

## 5. Safety architecture

```mermaid
flowchart TB
    subgraph roles["Roles"]
        G["Guardian<br/>hot key"]
        AD["Admin<br/>multisig ≥2-of-N"]
        TR["Treasury"]
    end
    G -->|pause only| PAUSE
    AD -->|unpause · upgrade · sweep<br/>wind-down · fee| PAUSE
    AD -->|72h timelock| UP["propose → wait → execute"]
    TR -->|withdraw fees| FEE["protocol fee<br/>(0 bps today)"]

    PAUSE{{"Pause"}}
    PAUSE -->|CLOSES| ENT["deposit · split<br/>swap_* · add_liquidity"]
    PAUSE -->|NEVER closes| EXIT["redeem · recombine<br/>redeem_at_maturity · claim_yield<br/>remove_liquidity · transfers"]
```

**A pause that traps user funds is worse than no pause.** Entries close, exits
never do — enforced by test in all three privileged contracts.

If Blend fails, `emergency_withdraw_all()` pulls the position into idle custody
and closes the market. The rate is then derived from idle custody by the same
formula, and redemption pays each holder their exact pro-rata slice.
Irreversible, so it cannot become a rate-manipulation lever.

See `docs/GOVERNANCE.md` and `docs/EMERGENCY_RUNBOOK.md`.

---

## 6. Known architectural gaps

Stated plainly so nobody mistakes their absence for a guarantee.

| Gap | Consequence |
|---|---|
| **No external audit** | The blocker for mainnet. Everything here is self-verified. |
| **Every action is 2 non-atomic signatures** | A failed second leg strands the user holding SY, which no screen surfaces. The deleted `intent_engine` did this atomically; nothing replaced it. |
| **One market per deployment** | No factory, so no rolling maturities — the core of the Pendle model. |
| **Blend is unrotatable** | Wind-down is an exit, not a migration. |
| **LP positions are not tokens** | No transfer, no composability, no LP incentives. |
| **Liquidity ~40 units** | A 4-unit order saturates the curve; selling YT reverts at size. |
