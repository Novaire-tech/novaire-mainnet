# Governance

Applies to `sy-wrapper`, `tokenizer`, `amm`. `pt-token` and `yt-token` carry no
privileged surface — their mint/burn is gated on the tokenizer's address and
nothing else, by design.

---

## The decision: upgradeable, with an exit

This protocol ships **upgradeable behind a 72-hour timelock**, not immutable.

The alternative was considered and rejected for v1. Immutability is a genuine
guarantee, but it is a **one-way door taken before an audit**, and it forecloses
every response to a bug discovered in production — including the class of bug
that was found and fixed in this very codebase (an exact-in swap that silently
confiscated user input; see `FINDINGS.md` P1-01).

Upgradeability is reversible. `renounce_admin()` permanently removes pause,
upgrade, sweep and reserve-migration authority, and it can be called once the
market has run a clean maturity cycle with an audit in hand. **Immutability is
therefore still available — just later, on evidence, rather than now on hope.**

---

## Roles

| Role | Powers | Must be |
|---|---|---|
| **Admin** | unpause, propose/execute/cancel upgrade, set guardian, set protocol fee, sweep, `migrate_reserve_index`, `emergency_withdraw_all`, renounce | **Multisig**, ≥2 signers and `med_threshold` ≥ 2. `deploy-mainnet.sh` refuses to run otherwise. |
| **Guardian** | **pause only** | A separate address from the admin. May be a single hot key — that is the point. |
| **Treasury** | withdraw accrued protocol fees | Any address; only it can move accrued fees, so a compromised admin cannot redirect them. |

Admin transfer is **two-step** (`propose_admin` → `accept_admin`) in all three
contracts. A one-step setter would let a typo permanently orphan governance.

---

## Pause is asymmetric, and it never traps funds

**Cheap to stop, deliberate to restart.** The guardian can pause with a single
signature, because stopping a live exploit must not wait on a multisig quorum.
Only the admin can unpause.

**What pause blocks — entries only:**

| Contract | Blocked |
|---|---|
| `sy-wrapper` | `deposit` |
| `tokenizer` | `split` |
| `amm` | all four `swap_*`, `add_liquidity` |

**What pause can never block — every exit:**

`sy_wrapper::redeem` · `tokenizer::recombine` · `redeem_at_maturity` ·
`claim_yield` · `observe_rate` · `amm::remove_liquidity` · every SEP-41
`transfer`/`burn` · every read-only quote.

This is a hard invariant, enforced by test
(`pause_blocks_entries_but_never_lets_lps_get_stuck`,
`pause_blocks_deposits_but_never_redemptions`, `pause_blocks_split_only`).
**A pause that strands user funds is worse than no pause at all.**

---

## Upgrade flow

```
propose_upgrade(wasm_hash)   → emits UpgradeProposed{wasm_hash, eta}
        │                       eta = now + 72h
        │  ← anyone watching the event has 72h to exit
        ▼
execute_upgrade()            → admin only, reverts before eta
cancel_upgrade()             → admin only, at any time
```

The timelock exists so the upgrade is **advertised before it binds**. Do not
shorten it. Storage layout compatibility is a permanent obligation once live:
never reorder or remove a `DataKey` variant.

---

## Emergency wind-down (`sy-wrapper`)

`config.pool` is fixed at initialization with no rotation. If Blend pauses the
reserve, deprecates it, or the position becomes unreadable, `exchange_rate()`
traps — and with it deposit, redeem, split, recombine, `redeem_at_maturity`, and
every AMM swap, because all of them read it. Without an escape hatch that state
is unrecoverable.

`emergency_withdraw_all()` pulls the entire Blend position into idle custody and
closes the market. Afterwards the rate is derived from idle custody by the same
formula used for the Blend position (`assets * WAD / supply`) — no frozen
snapshot, no second code path — and `redeem` pays each holder their exact
pro-rata slice of what was recovered.

**Irreversible on purpose.** Allowing a return to Blend would turn a safety
valve into a rate-manipulation lever.

---

## Protocol fee

Ships at **0 bps**, so launch economics are byte-identical to having no switch.
`set_protocol_fee(share_bps, treasury)` routes a share of the **swap fee** —
never of the trade — to the treasury, capped at 50% so LPs always keep the
majority of what they earn.

**Known limitation:** accrual is wired on the two plain PT↔SY paths only. The YT
flash routes are composite trades that mint and burn through the tokenizer, and
threading a fee deduction through them would disturb the dust accounting the
escrow invariants depend on. They contribute no protocol fee today. Tracked in
`FINDINGS.md`.

---

## Renouncing

`renounce_admin()` permanently disables pause, upgrade, sweep, fee changes,
reserve migration and wind-down. **Do not call it until:**

1. an external audit is complete and its findings are remediated,
2. the market has completed at least one full maturity cycle on mainnet,
3. a bug bounty has been live long enough to be meaningful.

It cannot be undone. That is the whole point, and the reason it is last.
