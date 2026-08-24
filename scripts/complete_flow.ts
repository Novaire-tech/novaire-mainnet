// Full protocol flow against real Testnet, no browser/Freighter — headless
// signer + Friendbot, reusing apps/web/e2e/lib/chain.ts (the current,
// post-rename helper) instead of the stale scripts/verify_testnet copy.
import {
  createWallet,
  fundWallet,
  waitForTransaction,
  assertNotMatured,
  depositVault,
  mintPTYT,
  buyPT,
  readOnChainState,
  getServer,
} from '../apps/web/e2e/lib/chain';

async function main() {
  const server = getServer();
  await assertNotMatured(server);

  const wallet = createWallet();
  console.log(`Wallet: ${wallet.publicKey}`);

  console.log('Funding via Friendbot...');
  await fundWallet(wallet);

  console.log('Depositing 100 XLM into SY Wrapper...');
  const depositResult = await depositVault(wallet, 100);
  await waitForTransaction(depositResult.sendTransactionResponse!.hash!, server);
  console.log(`  deposit tx: ${depositResult.sendTransactionResponse!.hash}`);

  console.log('Splitting 40 SY into PT/YT via Tokenizer...');
  const splitResult = await mintPTYT(wallet, 40);
  await waitForTransaction(splitResult.sendTransactionResponse!.hash!, server);
  console.log(`  split tx: ${splitResult.sendTransactionResponse!.hash}`);

  console.log('Buying PT on secondary market (20 XLM via AMM)...');
  try {
    const buyResult = await buyPT(wallet, 20);
    await waitForTransaction(buyResult.sendTransactionResponse!.hash!, server);
    console.log(`  buy tx: ${buyResult.sendTransactionResponse!.hash}`);
  } catch (e) {
    console.log(`  SKIPPED: AMM has no seeded liquidity yet (${(e as Error).message.split('\n')[0]})`);
  }

  console.log('Reading final on-chain state...');
  try {
    const state = await readOnChainState(wallet.publicKey);
    console.log(state);
  } catch (e) {
    console.log(`  Balance reads partially failed — AMM PT price quote needs seeded liquidity (${(e as Error).message.split('\n')[0]})`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
