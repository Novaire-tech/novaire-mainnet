// Creates N funded testnet accounts and deposits `amount` XLM each into the
// Novaire vault via the Intent Engine contract's execute_fixed_yield_intent.
// Usage: node seed-deposits.mjs [count] [xlmAmount]
import { Keypair, rpc } from '@stellar/stellar-sdk';
import { basicNodeSigner } from '@stellar/stellar-sdk/contract';
import { Client } from '/home/ahir/Projects/Novaire/packages/bindings/intent_engine/src/index.ts';
import deployments from '/home/ahir/Projects/Novaire/apps/web/src/config/deployments.testnet.json' with { type: 'json' };

const RPC_URL = 'https://soroban-testnet.stellar.org';
const HORIZON_URL = 'https://horizon-testnet.stellar.org';
const NETWORK_PASSPHRASE = 'Test SDF Network ; September 2015';
const FRIENDBOT_URL = 'https://friendbot.stellar.org';

const COUNT = parseInt(process.argv[2] || '10', 10);
const XLM_AMOUNT = parseFloat(process.argv[3] || '100');

async function fundViaFriendbot(publicKey) {
  const res = await fetch(`${FRIENDBOT_URL}?addr=${encodeURIComponent(publicKey)}`);
  if (!res.ok && res.status !== 400) {
    throw new Error(`Friendbot funding failed: ${res.status} ${await res.text()}`);
  }
}

async function waitForAccount(publicKey, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const res = await fetch(`${HORIZON_URL}/accounts/${publicKey}`);
    if (res.ok) return;
    await new Promise((r) => setTimeout(r, 1500));
  }
  throw new Error(`Timed out waiting for account ${publicKey} on Horizon`);
}

async function depositFor(keypair, server, maturityLedger) {
  const signer = basicNodeSigner(keypair, NETWORK_PASSPHRASE);
  const client = new Client({
    contractId: deployments.intent_engine,
    rpcUrl: RPC_URL,
    networkPassphrase: NETWORK_PASSPHRASE,
    publicKey: keypair.publicKey(),
    ...signer,
  });

  const amountStroops = BigInt(Math.floor(XLM_AMOUNT * 10_000_000));
  const txArgs = {
    user: keypair.publicKey(),
    usdc_amount: amountStroops,
    min_implied_rate: BigInt(0),
    min_underlying_out: BigInt(0),
    _maturity_ledger: maturityLedger,
    yt_sale_percentage: 0,
  };

  const tx = await client.execute_fixed_yield_intent(txArgs);
  const result = await tx.signAndSend();
  return result;
}

async function main() {
  const server = new rpc.Server(RPC_URL, { allowHttp: true });
  const latestLedger = await server.getLatestLedger();
  const deploymentMaturity = Number(deployments.maturity_ledger);
  if (latestLedger.sequence >= deploymentMaturity) {
    throw new Error(`Testnet fixture matured (ledger ${latestLedger.sequence} >= ${deploymentMaturity})`);
  }
  // Mirrors MintModal.tsx: `_maturity_ledger` param is underscore-prefixed
  // (unused by the contract) but the app always sends latest+50000.
  const maturityLedger = latestLedger.sequence + 50000;

  const results = [];
  for (let i = 0; i < COUNT; i++) {
    const keypair = Keypair.random();
    const label = `[${i + 1}/${COUNT}] ${keypair.publicKey()}`;
    try {
      console.log(`${label} funding via Friendbot...`);
      await fundViaFriendbot(keypair.publicKey());
      await waitForAccount(keypair.publicKey());

      console.log(`${label} depositing ${XLM_AMOUNT} XLM...`);
      const res = await depositFor(keypair, server, maturityLedger);
      console.log(`${label} OK`, res?.getTransactionResponse?.status ?? res);
      results.push({ publicKey: keypair.publicKey(), secret: keypair.secret(), status: 'ok' });
    } catch (e) {
      console.error(`${label} FAILED:`, e.message || e);
      results.push({ publicKey: keypair.publicKey(), secret: keypair.secret(), status: 'failed', error: String(e.message || e) });
    }
  }

  console.log('\n=== Summary ===');
  for (const r of results) {
    console.log(`${r.status.toUpperCase()}  ${r.publicKey}${r.error ? '  ' + r.error : ''}`);
  }
}

main().catch((e) => {
  console.error('Fatal:', e);
  process.exit(1);
});
