// Generates real testnet traction: creates N fresh wallets, funds them via
// Friendbot, and runs each through a deposit -> split -> buyPT -> addLiquidity
// flow against the live Novaire contracts. Logs every tx hash to
// scripts/traction-report.json for the README.
import {
  createWallet,
  fundWallet,
  waitForTransaction,
  assertNotMatured,
  depositVault,
  mintPTYT,
  buyPT,
  addLiquidity,
  getServer,
  type Wallet,
} from '../apps/web/e2e/lib/chain';
import { writeFileSync } from 'fs';
import { join } from 'path';

const NUM_WALLETS = Number(process.env.NUM_WALLETS ?? 10);
const OUT_FILE = process.env.OUT_FILE ?? 'traction-report.json';

interface TxRecord {
  wallet: string;
  op: string;
  hash?: string;
  status: 'ok' | 'skipped' | 'failed';
  detail?: string;
}

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms)),
  ]);
}

function saveReport(records: TxRecord[], numWallets: number) {
  const onChainCount = records.filter((r) => r.status === 'ok' && r.hash).length;
  const summary = {
    generated_at: new Date().toISOString(),
    network: 'testnet',
    wallets: numWallets,
    on_chain_transactions: onChainCount,
    records,
  };
  writeFileSync(join(__dirname, OUT_FILE), JSON.stringify(summary, null, 2));
}

async function runOp(
  wallet: Wallet,
  op: string,
  fn: () => Promise<{ sendTransactionResponse?: { hash?: string } }>,
  server: ReturnType<typeof getServer>,
  records: TxRecord[],
  numWallets: number,
): Promise<boolean> {
  try {
    const res = await withTimeout(fn(), 45_000, op);
    const hash = res.sendTransactionResponse!.hash!;
    await withTimeout(waitForTransaction(hash, server), 45_000, `${op}_confirm`);
    records.push({ wallet: wallet.publicKey, op, hash, status: 'ok' });
    console.log(`  [${op}] ok ${hash}`);
    saveReport(records, numWallets);
    return true;
  } catch (e) {
    const detail = String((e as Error).message).split('\n')[0];
    records.push({ wallet: wallet.publicKey, op, status: 'failed', detail });
    console.log(`  [${op}] failed: ${detail}`);
    saveReport(records, numWallets);
    return false;
  }
}

async function runWallet(server: ReturnType<typeof getServer>, i: number, records: TxRecord[], numWallets: number) {
  const wallet: Wallet = createWallet();
  console.log(`[wallet ${i}] ${wallet.publicKey}`);

  await withTimeout(fundWallet(wallet), 30_000, 'friendbot_fund');
  records.push({ wallet: wallet.publicKey, op: 'friendbot_fund', status: 'ok' });
  console.log(`  [friendbot_fund] ok`);
  saveReport(records, numWallets);

  const depositOk = await runOp(wallet, 'deposit_vault', () => depositVault(wallet, 50), server, records, numWallets);
  if (!depositOk) return;

  await runOp(wallet, 'split_pt_yt', () => mintPTYT(wallet, 20), server, records, numWallets);
  await runOp(wallet, 'buy_pt', () => buyPT(wallet, 10), server, records, numWallets);
  await runOp(wallet, 'add_liquidity', () => addLiquidity(wallet, 5, 5), server, records, numWallets);
}

async function main() {
  const server = getServer();
  await assertNotMatured(server);

  const records: TxRecord[] = [];
  const CONCURRENCY = Number(process.env.CONCURRENCY ?? 4);
  let next = 0;
  async function worker() {
    while (next < NUM_WALLETS) {
      const i = next++;
      try {
        await runWallet(server, i, records, NUM_WALLETS);
      } catch (e) {
        console.error(`[wallet ${i}] fatal: ${(e as Error).message}`);
      }
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));

  const onChainCount = records.filter((r) => r.status === 'ok' && r.hash).length;
  saveReport(records, NUM_WALLETS);
  console.log(`\nDone. ${onChainCount} on-chain transactions across ${NUM_WALLETS} wallets.`);
  console.log(`Report written to ${join(__dirname, OUT_FILE)}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
