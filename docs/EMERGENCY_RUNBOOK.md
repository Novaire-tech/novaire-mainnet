# Emergency Runbook

Written to be followed at 3am by someone who did not write the contracts.
Addresses live in `deployments/<network>.toml`. Roles are defined in
`docs/GOVERNANCE.md`.

---

## 0. First 60 seconds — pause

If you suspect **anything** — an unexplained reserve move, an unexpected rate,
an exploit report — pause first and investigate second. Pausing is cheap,
reversible, and **cannot trap user funds**: every exit path stays open.

```bash
for C in "$SY_WRAPPER" "$TOKENIZER" "$AMM"; do
  stellar contract invoke --id "$C" --source guardian --network mainnet -- pause
done
```

The **guardian** key is enough. Do not wait for the admin multisig.

Verify:
```bash
stellar contract invoke --id "$AMM" --source guardian --network mainnet -- is_paused
```

**Still working while paused** (confirm at least one, so you know users are not
trapped): `sy_wrapper.redeem`, `tokenizer.redeem_at_maturity`,
`tokenizer.claim_yield`, `amm.remove_liquidity`, all token transfers.

---

## 1. Triage

| Symptom | Likely cause | Go to |
|---|---|---|
| `exchange_rate` traps with `#10 InvalidBlendReserve` | Blend moved the underlying to a new reserve slot | §2 |
| `exchange_rate` traps otherwise, or Blend is paused/deprecated | Blend-side failure | §3 |
| Reserves moved without a matching swap event | Investigate before unpausing | §4 |
| A swap returns far less than quoted | Check `untracked_balance()` and open a finding | §4 |
| Rate fell | Blend realised a loss. Not a bug — PT is senior, shortfalls are priced pro-rata at redemption | monitor only |

---

## 2. Blend reindexed the underlying

Recoverable without wind-down.

```bash
stellar contract invoke --id "$SY_WRAPPER" --source admin --network mainnet -- \
  migrate_reserve_index --admin "$ADMIN_ADDRESS"
```

This re-derives the index from the pool itself and accepts it only if the asset
at the new slot is still `config.underlying`. It cannot be aimed at a different
asset. Confirm `exchange_rate()` reads again, then unpause.

---

## 3. Blend failed — wind down

**Irreversible. There is no path back to Blend.** Use only when Blend cannot be
relied on to custody or price the position.

```bash
stellar contract invoke --id "$SY_WRAPPER" --source admin --network mainnet -- \
  emergency_withdraw_all
```

Then:
1. Note `recovered` in the `EmergencyWithdrawal` event and compare it to the
   last known AUM. A shortfall is real loss and is shared pro-rata.
2. Confirm `exchange_rate()` returns (now derived from idle custody).
3. Confirm a small `redeem` pays out.
4. **Leave deposits closed.** They cannot be reopened, and unpausing will not
   reopen them.
5. Announce: users redeem pro-rata; PT holders are senior; banked YT yield is
   paid from any surplus.

---

## 4. Suspected exploit

1. Stay paused.
2. Capture state: `amm.state()`, `amm.untracked_balance()`,
   `sy_wrapper.exchange_rate()`, `sy_wrapper.total_supply()`,
   `pt_token.total_supply()`, `yt_token.total_supply()`,
   `tokenizer.escrowed_sy()`. `scripts/probe-live.mjs` prints all of these.
3. Reproduce in a test before writing a fix. A fix without a failing test is
   not a fix.
4. Ship via `propose_upgrade` → **72h timelock** → `execute_upgrade`. Announce
   at proposal time; the timelock exists so users can exit if they disagree.
5. If the fix cannot wait 72h, the honest options are wind-down (§3) or staying
   paused. There is no fast path, by design.

---

## 5. Compromised keys

**Guardian compromised** — worst case is a nuisance pause; it cannot unpause,
move funds, or upgrade. Rotate at leisure: `set_guardian(new)`.

**Admin multisig compromised** — severe. The admin can schedule upgrades, sweep
non-protocol tokens, and wind down. The 72h timelock is the defence: watch for
`UpgradeProposed` and `cancel_upgrade` from a surviving quorum. If quorum is
lost, wind down (§3) while you still control the multisig — a wind-down returns
funds pro-rata and closes the market, which is strictly better than losing it to
a scheduled malicious upgrade.

Rotate with `propose_admin(new)` then `accept_admin()` from the new address.

---

## 6. Before unpausing

- [ ] Root cause understood and written down
- [ ] Fix has a regression test that fails on the previous commit
- [ ] `cargo test --workspace --all-features` green
- [ ] `scripts/probe-live.mjs` reviewed against pre-incident values
- [ ] Users informed of what happened and what changed

Unpause is admin-only. That is deliberate: restarting should take more people
than stopping did.
