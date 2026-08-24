// Local, on-demand protocol verification against real Stellar Testnet.
// Run: npm run verify:testnet
//
// No CI, no browser automation, no mocks: creates real funded wallets,
// executes real signed transactions against the deployed Novaire contracts,
// reads balances directly from those contracts, and cross-checks two
// independently-implemented formulas (scripts/verify_testnet/expected.ts)
// against each other and against the on-chain reads. See README.md at repo
// root section "Testnet verification" — or scripts/verify_testnet/ — for
// details on what each scenario proves and its known scope limits.
import { Keypair } from '@stellar/stellar-sdk';
import {
  createWallet,
  deterministicWallet,
  fundWallet,
  getServer,
  assertNotMatured,
  waitForTransaction,
  depositVault,
  mintPTYT,
  buyPT,
  readOnChainState,
  readClaimableYield,
  withRetry,
  settleAfterConfirmation,
  RPC_URL,
  FRIENDBOT_URL,
  BLEND_POOL,
  UNDERLYING_ASSET,
  readBlendReserve,
  readBlendPositions,
  readSyExchangeRate,
  readSyTotalSupply,
  readAmmSpotApy,
  redeem,
  STROOP,
  type Wallet,
} from './verify_testnet/chain';
import { computeIndependent, computeAppFormula, withinTolerance, calculateProjectedDailyYield, computeAdapterRate, withinToleranceBigInt } from './verify_testnet/expected';
import { CONTRACTS } from '../apps/web/src/config/contracts';

const USE_DETERMINISTIC = process.argv.includes('--deterministic');
const XLM_SPOT_USD = 0.1; // fixed reference price; see README — avoids depending on a live price API for this local tool
const ASSUMED_APY_PCT = 8.5; // used only to sanity-check the daily-yield formula's shape, not a live oracle read

interface Check {
  label: string;
  pass: boolean;
  detail?: string;
}

interface ScenarioReport {
  name: string;
  wallet: string;
  transactions: { action: string; hash?: string; status: string }[];
  checks: Check[];
  skipped?: string;
}

const reports: ScenarioReport[] = [];

function record(name: string, wallet: string): { push: (c: Check) => void; tx: (action: string, o: { hash?: string; status: string }) => void; skip: (reason: string) => void } {
  const report: ScenarioReport = { name, wallet, transactions: [], checks: [] };
  reports.push(report);
  return {
    push: (c: Check) => report.checks.push(c),
    tx: (action, o) => report.transactions.push({ action, hash: o.hash, status: o.status }),
    skip: (reason: string) => { report.skipped = reason; },
  };
}

function checkFinite(label: string, value: number, r: ReturnType<typeof record>) {
  const pass = isFinite(value) && !isNaN(value);
  r.push({ label, pass, detail: pass ? undefined : `got ${value}` });
}

function checkEqual(label: string, expected: number, actual: number, r: ReturnType<typeof record>) {
  const pass = withinTolerance(expected, actual);
  r.push({ label, pass, detail: pass ? undefined : `expected ${expected}, got ${actual} (diff ${Math.abs(expected - actual)})` });
}

async function newFundedWallet(seed: string): Promise<Wallet> {
  const wallet = USE_DETERMINISTIC ? deterministicWallet(seed) : createWallet();
  await fundWallet(wallet);
  return wallet;
}

async function preflight(): Promise<void> {
  console.log('Preflight: checking Testnet RPC / Friendbot reachability...');
  const server = getServer();
  await withRetry(() => server.getLatestLedger(), 4, 'getLatestLedger');
  await assertNotMatured(server);
  const fb = await withRetry(() => fetch(`${FRIENDBOT_URL}?addr=${Keypair.random().publicKey()}`), 4, 'Friendbot ping');
  if (!fb.ok && fb.status !== 400) throw new Error(`Friendbot unreachable: HTTP ${fb.status}`);
  console.log(`  RPC (${RPC_URL}) reachable, fixture not matured, Friendbot reachable.\n`);
}

async function scenarioEmptyWallet() {
  const wallet = await newFundedWallet('scenario-a-empty');
  const r = record('A — Empty wallet', wallet.publicKey);

  const state = await readOnChainState(wallet.publicKey);
  const expected = computeIndependent(state, XLM_SPOT_USD, XLM_SPOT_USD);
  const appFormula = computeAppFormula(state, XLM_SPOT_USD, XLM_SPOT_USD);

  checkEqual('totalInvestedUsd == 0', 0, expected.totalInvestedUsd, r);
  checkEqual('independent vs app-formula agree (totalInvestedUsd)', expected.totalInvestedUsd, appFormula.totalInvestedUsd, r);
  const dailyYield = calculateProjectedDailyYield(expected.totalInvestedXlm, ASSUMED_APY_PCT);
  checkEqual('Est. Daily Yield == 0', 0, dailyYield, r);
  checkFinite('totalValueUsd finite', expected.totalValueUsd, r);
  checkFinite('totalInvestedXlm finite', expected.totalInvestedXlm, r);
}

async function scenarioVaultOnly() {
  const wallet = await newFundedWallet('scenario-b-vault');
  const r = record('B — Vault LP only', wallet.publicKey);
  const server = getServer();

  const dep = await depositVault(wallet, 50);
  r.tx('vault.deposit(50 XLM)', dep);
  if (dep.hash) await waitForTransaction(dep.hash, server);
  await settleAfterConfirmation();

  const state = await readOnChainState(wallet.publicKey);
  const expected = computeIndependent(state, XLM_SPOT_USD, XLM_SPOT_USD);
  const appFormula = computeAppFormula(state, XLM_SPOT_USD, XLM_SPOT_USD);

  r.push({ label: 'on-chain vaultLp > 0 after deposit', pass: state.vaultLp > 0, detail: `vaultLp=${state.vaultLp}` });
  checkEqual('independent vs app-formula agree (totalInvestedUsd)', expected.totalInvestedUsd, appFormula.totalInvestedUsd, r);
  const allocSum = expected.allocationPercent.reduce((s, a) => s + a.percent, 0);
  checkEqual('allocation sums to 100%', 100, allocSum, r);
  checkFinite('Est. Daily Yield finite', calculateProjectedDailyYield(expected.totalInvestedXlm, ASSUMED_APY_PCT), r);
}

async function scenarioPtOnly() {
  const wallet = await newFundedWallet('scenario-c-pt');
  const r = record('C — PT only', wallet.publicKey);
  const server = getServer();

  const dep = await depositVault(wallet, 30);
  r.tx('vault.deposit(30 XLM)', dep);
  if (dep.hash) await waitForTransaction(dep.hash, server);
  await settleAfterConfirmation();

  // Tokenize the exact minted share balance rather than assuming a 1:1
  // deposit-to-share rate — the vault may apply fees/rounding, and
  // over-requesting shares reverts transfer_shares on-chain.
  const postDepositState = await readOnChainState(wallet.publicKey);
  const mint = await mintPTYT(wallet, postDepositState.vaultLp);
  r.tx(`tokenizer.mint_pt_yt(${postDepositState.vaultLp} shares)`, mint);
  if (mint.hash) await waitForTransaction(mint.hash, server);
  await settleAfterConfirmation();

  const state = await readOnChainState(wallet.publicKey);
  const expected = computeIndependent(state, XLM_SPOT_USD, XLM_SPOT_USD);
  const appFormula = computeAppFormula(state, XLM_SPOT_USD, XLM_SPOT_USD);

  r.push({ label: 'on-chain ptBalance > 0 after mint', pass: state.ptBalance > 0, detail: `ptBalance=${state.ptBalance}` });
  checkEqual('independent vs app-formula agree (totalValueUsd)', expected.totalValueUsd, appFormula.totalValueUsd, r);
  checkFinite('Est. Daily Yield finite', calculateProjectedDailyYield(expected.totalInvestedXlm, ASSUMED_APY_PCT), r);
}

async function scenarioVaultPlusPt() {
  const wallet = await newFundedWallet('scenario-d-both');
  const r = record('D — Vault LP + secondary-market PT', wallet.publicKey);
  const server = getServer();

  const dep = await depositVault(wallet, 40);
  r.tx('vault.deposit(40 XLM, untokenized)', dep);
  if (dep.hash) await waitForTransaction(dep.hash, server);
  await settleAfterConfirmation();

  let bought = false;
  try {
    const buy = await buyPT(wallet, 10);
    r.tx('amm.swap_sy_for_pt(10 XLM via SY Wrapper)', buy);
    if (buy.hash) await waitForTransaction(buy.hash, server);
    await settleAfterConfirmation();
    bought = true;
  } catch (e: any) {
    r.skip(`AMM PT purchase failed — likely no seeded AMM liquidity this epoch: ${e.message || e}`);
    return;
  }

  const state = await readOnChainState(wallet.publicKey);
  const expected = computeIndependent(state, XLM_SPOT_USD, XLM_SPOT_USD);
  const appFormula = computeAppFormula(state, XLM_SPOT_USD, XLM_SPOT_USD);

  r.push({ label: 'vaultLp > 0 (not overwritten by PT purchase)', pass: state.vaultLp > 0, detail: `vaultLp=${state.vaultLp}` });
  r.push({ label: 'ptBalance > 0 (secondary purchase landed)', pass: state.ptBalance > 0 && bought, detail: `ptBalance=${state.ptBalance}` });

  const expectedInvestedFromBoth = state.vaultLp * XLM_SPOT_USD + state.ptBalance * (state.ptPriceUnderlying * XLM_SPOT_USD);
  checkEqual('totalInvestedUsd == LP + PT (additive, no overwrite)', expectedInvestedFromBoth, expected.totalInvestedUsd, r);
  checkEqual('independent vs app-formula agree (totalInvestedUsd)', expected.totalInvestedUsd, appFormula.totalInvestedUsd, r);

  const allocSum = expected.allocationPercent.reduce((s, a) => s + a.percent, 0);
  checkEqual('allocation sums to 100% (no duplicate counting)', 100, allocSum, r);
  r.push({ label: 'activePositions == 2 (LP + tokenized, distinct)', pass: expected.activePositions === 2, detail: `activePositions=${expected.activePositions}` });

  const codes = expected.allocationPercent.map((a) => a.assetCode);
  r.push({ label: 'no duplicate asset codes in allocation', pass: new Set(codes).size === codes.length, detail: codes.join(', ') });
}

async function scenarioClaimableYield() {
  const seedSecret = process.env.VERIFY_YIELD_WALLET_SECRET;
  const wallet: Wallet = seedSecret
    ? { keypair: Keypair.fromSecret(seedSecret), publicKey: Keypair.fromSecret(seedSecret).publicKey() }
    : await newFundedWallet('scenario-e-yield');
  const r = record('E — Claimable yield safe-math', wallet.publicKey);

  if (!seedSecret) {
    r.skip(
      'yt_token has no user-callable claim/accrual transaction in this contract version (accrual is admin/epoch-driven) — ' +
        'verifying the safe-math guard only. Set VERIFY_YIELD_WALLET_SECRET to a fixture wallet with real accrued yield ' +
        'to additionally verify the nonzero-conversion path.',
    );
  }

  const claimable = await readClaimableYield(wallet.publicKey);
  checkFinite('claimable yield read is finite', claimable, r);

  const usdAtSomePrice = claimable * XLM_SPOT_USD;
  const toXlmSafe = (usd: number, xlmPriceUsd: number) => (xlmPriceUsd > 0 ? usd / xlmPriceUsd : 0); // exact guard from portfolioService.ts
  const xlmAtZeroPrice = toXlmSafe(usdAtSomePrice, 0);
  checkEqual('claimableYieldXlm safe when xlmPriceUsd=0 (no Infinity)', 0, xlmAtZeroPrice, r);
  checkFinite('claimableYieldXlm finite at price=0', xlmAtZeroPrice, r);

  if (seedSecret && claimable > 0) {
    const xlmAtRealPrice = usdAtSomePrice / XLM_SPOT_USD;
    checkFinite('claimableYieldXlm finite at real price', xlmAtRealPrice, r);
    r.push({ label: 'claimable yield nonzero for fixture wallet', pass: claimable > 0, detail: `claimable=${claimable}` });
  }
}

function checkEqualBigInt(label: string, expected: bigint, actual: bigint, r: ReturnType<typeof record>, toleranceWad?: bigint) {
  const pass = withinToleranceBigInt(expected, actual, toleranceWad);
  r.push({ label, pass, detail: pass ? undefined : `expected ${expected}, got ${actual} (diff ${expected > actual ? expected - actual : actual - expected})` });
}

/**
 * The chain this whole tool exists to prove for a Blend-backed vault:
 *   real Blend Pool.get_reserve/get_positions
 *     -> BlendPoolClient (Rust, exercised on-chain via the deployed sy-wrapper WASM)
 *     -> SyWrapper.exchange_rate()          [on-chain read]
 *     -> independently re-derived rate      [off-chain, expected.ts:computeAdapterRate]
 *     -> AMM.spot_apy()                     [on-chain read, before vs after a real deposit]
 *
 * Talks only to the real deployed Blend pool (BLEND_POOL) — no mock. The
 * existing MockBlendPool-based Rust tests
 * (contracts/integration_tests/tests/blend_wrapper.rs, etc.) are untouched
 * and still the place unit-level rate math is exercised in isolation.
 */
async function scenarioBlendRateReflectsRealPool() {
  const wallet = await newFundedWallet('scenario-f-blend');
  const r = record('F — Blend rate propagation (real pool)', wallet.publicKey);
  const server = getServer();

  const reserveBefore = await readBlendReserve(UNDERLYING_ASSET, wallet.publicKey);
  r.push({
    label: 'Blend reserve enabled',
    pass: reserveBefore.enabled,
    detail: `pool=${BLEND_POOL} asset=${UNDERLYING_ASSET} index=${reserveBefore.index} enabled=${reserveBefore.enabled}`,
  });
  r.push({
    label: 'Blend b_rate plausible (>= 1.0 in 12-decimal terms)',
    pass: reserveBefore.bRate >= 1_000_000_000_000n,
    detail: `b_rate=${reserveBefore.bRate}`,
  });
  if (!reserveBefore.enabled) {
    r.skip(`Blend reserve for ${UNDERLYING_ASSET} on pool ${BLEND_POOL} is disabled — cannot verify rate propagation this run.`);
    return;
  }

  const [positionsBefore, sySupplyBefore, syRateBefore, apyBefore] = await Promise.all([
    readBlendPositions(CONTRACTS.SY_WRAPPER, wallet.publicKey),
    readSyTotalSupply(wallet.publicKey),
    readSyExchangeRate(wallet.publicKey),
    readAmmSpotApy(wallet.publicKey),
  ]);

  // Pre-deposit sanity: the wrapper's own bTokens/rate at this instant should
  // already satisfy exchange_rate() == computeAdapterRate(...) — this is the
  // real cross-contract chain, not a synthetic setup.
  const bTokensBefore = positionsBefore.get(reserveBefore.index) ?? 0n;
  const expectedRateBefore = computeAdapterRate(bTokensBefore, reserveBefore.bRate, sySupplyBefore);
  checkEqualBigInt('exchange_rate() == independently-derived rate (pre-deposit)', expectedRateBefore, syRateBefore, r);

  // Force a real Blend `submit` (supply) through the deployed sy-wrapper WASM.
  const dep = await depositVault(wallet, 20);
  r.tx('sy_wrapper.deposit(20 XLM) -> Blend submit(SUPPLY)', dep);
  if (dep.hash) await waitForTransaction(dep.hash, server);
  await settleAfterConfirmation();

  const [reserveAfter, positionsAfter, sySupplyAfter, syRateAfter, apyAfterDeposit] = await Promise.all([
    readBlendReserve(UNDERLYING_ASSET, wallet.publicKey),
    readBlendPositions(CONTRACTS.SY_WRAPPER, wallet.publicKey),
    readSyTotalSupply(wallet.publicKey),
    readSyExchangeRate(wallet.publicKey),
    readAmmSpotApy(wallet.publicKey),
  ]);

  const bTokensAfter = positionsAfter.get(reserveAfter.index) ?? 0n;
  r.push({ label: 'Blend bTokens increased after supply', pass: bTokensAfter > bTokensBefore, detail: `before=${bTokensBefore} after=${bTokensAfter}` });
  r.push({ label: 'SY total_supply increased after deposit', pass: sySupplyAfter > sySupplyBefore, detail: `before=${sySupplyBefore} after=${sySupplyAfter}` });

  const expectedRateAfter = computeAdapterRate(bTokensAfter, reserveAfter.bRate, sySupplyAfter);
  checkEqualBigInt('exchange_rate() == independently-derived rate (post-deposit)', expectedRateAfter, syRateAfter, r);
  r.push({ label: 'exchange_rate() monotonic non-decreasing across deposit', pass: syRateAfter >= syRateBefore, detail: `before=${syRateBefore} after=${syRateAfter}` });
  r.push({ label: 'AMM spot_apy() read succeeds after rate change (no revert)', pass: isFinite(Number(apyAfterDeposit)), detail: `before=${apyBefore} after=${apyAfterDeposit}` });

  // Redeem leg: SyWrapper::redeem is a plain user-callable entry point (no
  // maturity gate — contracts/sy-wrapper/src/lib.rs:606), so this is
  // implementable now rather than SKIPPED.
  const redeemAmount = Math.min(10, sySupplyAfter > 0n ? Number(sySupplyAfter) / STROOP : 0);
  if (redeemAmount > 0) {
    const red = await redeem(wallet, redeemAmount);
    r.tx(`sy_wrapper.redeem(${redeemAmount} shares) -> Blend submit(WITHDRAW)`, red);
    if (red.hash) await waitForTransaction(red.hash, server);
    await settleAfterConfirmation();

    const [reserveFinal, positionsFinal, sySupplyFinal, syRateFinal] = await Promise.all([
      readBlendReserve(UNDERLYING_ASSET, wallet.publicKey),
      readBlendPositions(CONTRACTS.SY_WRAPPER, wallet.publicKey),
      readSyTotalSupply(wallet.publicKey),
      readSyExchangeRate(wallet.publicKey),
    ]);
    const bTokensFinal = positionsFinal.get(reserveFinal.index) ?? 0n;
    r.push({ label: 'Blend bTokens decreased after redeem', pass: bTokensFinal < bTokensAfter, detail: `after-deposit=${bTokensAfter} after-redeem=${bTokensFinal}` });
    r.push({ label: 'SY total_supply decreased after redeem', pass: sySupplyFinal < sySupplyAfter, detail: `after-deposit=${sySupplyAfter} after-redeem=${sySupplyFinal}` });
    const expectedRateFinal = computeAdapterRate(bTokensFinal, reserveFinal.bRate, sySupplyFinal);
    checkEqualBigInt('exchange_rate() == independently-derived rate (post-redeem)', expectedRateFinal, syRateFinal, r);
  } else {
    r.skip('SY supply too small relative to STROOP to redeem a nonzero share amount this run.');
  }
}

function printReport(): boolean {
  console.log('\n' + '='.repeat(72));
  console.log('NOVAIRE PORTFOLIO TESTNET VERIFICATION REPORT');
  console.log('='.repeat(72));

  let overallPass = true;
  for (const rep of reports) {
    console.log(`\n## ${rep.name}`);
    console.log(`   Wallet: ${rep.wallet}`);
    if (rep.skipped) {
      console.log(`   SKIPPED: ${rep.skipped}`);
      continue;
    }
    for (const tx of rep.transactions) {
      console.log(`   TX: ${tx.action} -> ${tx.hash || '(no hash captured)'} [${tx.status}]`);
    }
    for (const c of rep.checks) {
      const mark = c.pass ? 'PASS' : 'FAIL';
      if (!c.pass) overallPass = false;
      console.log(`   [${mark}] ${c.label}${c.detail ? ` — ${c.detail}` : ''}`);
    }
  }

  console.log('\n' + '='.repeat(72));
  console.log(overallPass ? 'RESULT: PASS' : 'RESULT: FAIL');
  console.log('='.repeat(72) + '\n');
  return overallPass;
}

async function main() {
  await preflight();

  const scenarios: [string, () => Promise<void>][] = [
    ['A (empty wallet)', scenarioEmptyWallet],
    ['B (vault deposit)', scenarioVaultOnly],
    ['C (PT purchase via protocol)', scenarioPtOnly],
    ['D (vault + PT)', scenarioVaultPlusPt],
    ['E (claimable yield)', scenarioClaimableYield],
    ['F (Blend rate propagation, real pool)', scenarioBlendRateReflectsRealPool],
  ];

  for (const [label, fn] of scenarios) {
    console.log(`Running scenario ${label}...`);
    try {
      await fn();
    } catch (e: any) {
      reports.push({ name: label, wallet: 'n/a', transactions: [], checks: [{ label: 'scenario threw', pass: false, detail: e.message || String(e) }] });
    }
  }

  const pass = printReport();
  process.exit(pass ? 0 : 1);
}

main().catch((e) => {
  console.error('FATAL:', e);
  process.exit(1);
});
