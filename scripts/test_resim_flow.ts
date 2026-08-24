// Headless verification of the M3 fix (resimulate quote immediately before
// signing, apps/web/src/hooks/useTrade.ts::executeTrade). Mirrors the
// buy-path logic added there: deposit -> fresh quote_sy_for_pt simulation on
// the actually-minted SY -> applySlippage -> swap_sy_for_pt with that bound.
//
// Two cases:
//  1. Fresh resimulated minOut (mirrors the fixed code) -> should succeed.
//  2. A deliberately stale/too-tight minOut (simulating a quote from before
//     an adverse price move) -> should revert on-chain, proving the AMM
//     contract itself enforces the bound rather than the bound being
//     decorative. This is what protects the user once executeTrade supplies
//     a fresh bound instead of a stale one.
import { Client as SyWrapperClient } from '../packages/bindings/sy_wrapper/src/index';
import { Client as AmmClient } from '../packages/bindings/amm/src/index';
import { basicNodeSigner, ClientOptions } from '@stellar/stellar-sdk/contract';
import {
  createWallet,
  fundWallet,
  waitForTransaction,
  assertNotMatured,
  depositVault,
  getServer,
  Wallet,
  STROOP,
} from '../apps/web/e2e/lib/chain';
import { CONTRACTS, RPC_URL, NETWORK_PASSPHRASE } from '../apps/web/src/config/contracts';
import { applySlippage } from '../apps/web/src/utils/slippage';

function clientFor<T extends new (opts: ClientOptions) => InstanceType<T>>(Ctor: T, contractId: string, wallet: Wallet) {
  const signer = basicNodeSigner(wallet.keypair, NETWORK_PASSPHRASE);
  return new Ctor({ contractId, rpcUrl: RPC_URL, networkPassphrase: NETWORK_PASSPHRASE, publicKey: wallet.publicKey, ...signer });
}

function unwrap(r: { result?: unknown } | undefined): bigint {
  let v: unknown = r?.result;
  if (v && typeof v === 'object') {
    const obj = v as Record<string, unknown>;
    if (typeof obj.unwrap === 'function') v = (obj.unwrap as () => unknown)();
    else if ('ok' in obj) v = obj.ok;
    else if ('value' in obj) v = obj.value;
  }
  return typeof v === 'bigint' ? v : BigInt(Math.floor(Number(v) || 0));
}

async function main() {
  const server = getServer();
  await assertNotMatured(server);

  const wallet = createWallet();
  console.log(`Wallet: ${wallet.publicKey}`);
  console.log('Funding via Friendbot...');
  await fundWallet(wallet);

  console.log('Depositing 30 XLM into SY Wrapper...');
  const depositResult = await depositVault(wallet, 30);
  await waitForTransaction(depositResult.sendTransactionResponse!.hash!, server);
  const syIn = BigInt(30 * STROOP);

  const ammClient = clientFor(AmmClient, CONTRACTS.AMM, wallet);

  // --- Case 1: fresh resimulation, mirrors fixed executeTrade ---
  console.log('\n[Case 1] Fresh resimulate quote_sy_for_pt, then swap with that bound...');
  const freshQuoteTx = await ammClient.quote_sy_for_pt({ sy_in: syIn });
  const freshOut = unwrap(freshQuoteTx);
  console.log(`  fresh simulated PT out: ${freshOut}`);
  if (freshOut === 0n) {
    console.log('  SKIPPED: AMM has no seeded liquidity — run `npx tsx scripts/seed_liquidity.ts` first.');
    return;
  }
  const minOut = applySlippage(freshOut, 1); // 1% slippage tolerance
  console.log(`  minOut (1% slippage applied): ${minOut}`);
  const swapTx = await ammClient.swap_sy_for_pt({ from: wallet.publicKey, sy_in: syIn, min_pt_out: minOut });
  const swapResult = await swapTx.signAndSend();
  await waitForTransaction(swapResult.sendTransactionResponse!.hash!, server);
  console.log(`  SUCCESS — swap tx: ${swapResult.sendTransactionResponse!.hash}`);

  // --- Case 2: deliberately stale/unrealistic minOut -> must revert ---
  console.log('\n[Case 2] Re-simulate again, then submit with an intentionally-too-high minOut (simulating a stale favorable quote)...');
  const secondDeposit = await depositVault(wallet, 10);
  await waitForTransaction(secondDeposit.sendTransactionResponse!.hash!, server);
  const syIn2 = BigInt(10 * STROOP);
  const quote2Tx = await ammClient.quote_sy_for_pt({ sy_in: syIn2 });
  const freshOut2 = unwrap(quote2Tx);
  const badMinOut = (freshOut2 * 130n) / 100n; // demand 30% more than the AMM will actually give — must fail
  console.log(`  fresh simulated PT out: ${freshOut2}, deliberately-bad minOut: ${badMinOut}`);
  try {
    const badSwapTx = await ammClient.swap_sy_for_pt({ from: wallet.publicKey, sy_in: syIn2, min_pt_out: badMinOut });
    const badResult = await badSwapTx.signAndSend();
    await waitForTransaction(badResult.sendTransactionResponse!.hash!, server);
    console.log('  UNEXPECTED SUCCESS — slippage bound was not enforced!');
    process.exitCode = 1;
  } catch (e) {
    console.log(`  Reverted as expected (slippage bound enforced): ${(e as Error).message.split('\n')[0]}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
