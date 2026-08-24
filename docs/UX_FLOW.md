# UX Flow

How a user moves through the app, and what each screen actually calls on-chain.

```mermaid
flowchart TD
    A([Landing /]) --> B[Connect Freighter]
    B --> C{What do you want?}

    C -->|Earn fixed| D["/app/trade — Buy PT"]
    C -->|Lever the yield| E["/app/trade — Buy YT"]
    C -->|Both legs| F["/app/mint"]

    F --> F1["sig 1: sy_wrapper.deposit()"]
    F1 --> F2["sig 2: tokenizer.split()"]
    F2 --> G([Holds PT + YT])

    D --> D1["sig 1: sy_wrapper.deposit()"]
    D1 --> D2["sig 2: amm.swap_sy_for_pt()"]
    D2 --> G

    E --> E1["sig 1: sy_wrapper.deposit()"]
    E1 --> E2["sig 2: amm.swap_sy_for_yt()<br/>(pool flash-splits internally)"]
    E2 --> G

    G --> H["/app/portfolio"]
    H -->|Anytime| I["tokenizer.claim_yield()<br/>YT yield, in SY"]
    H -->|Exit early| J["amm.swap_*_for_sy()<br/>then sy_wrapper.redeem()"]
    H -->|At maturity| K["tokenizer.redeem_at_maturity()<br/>PT → principal at frozen rate"]

    I --> G
    J --> L([Underlying back in wallet])
    K --> L
```

**Value flow underneath**

```mermaid
flowchart LR
    U[USDC / XLM] -->|deposit| SY[SY shares]
    SY -->|Blend v2 supply| BL[(Blend pool)]
    BL -.->|b_rate rises = interest| SY
    SY -->|split| PT[PT · principal]
    SY -->|split| YT[YT · yield claim]
    PT <-->|curve| AMM{{AMM}}
    YT <-->|flash split/recombine| AMM
    PT -->|at maturity| U
    YT -->|claim_yield| U
```

`PT + YT = 1 unit of face.` PT redeems at 1.0 at maturity, so buying it below
par locks a fixed rate. YT costs the difference and collects all the yield.

---

## Known rough edges

- **Every action is 2 signatures and is not atomic.** If the second leg fails or
  is rejected, the user is left holding SY, which no screen surfaces as a
  position. The old architecture had an `intent_engine` router for this; it was
  deleted and never replaced.
- **`/app/markets/[id]` and `/app/markets/create` are stubs.** There is no
  factory, so there is only ever one market.
- **Selling YT reverts at any real size** on the current pool (`#17`). That is
  liquidity depth, not a bug — but it presents as a broken button.
