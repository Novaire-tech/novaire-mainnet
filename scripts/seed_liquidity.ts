// Seeds AMM liquidity on testnet using a fresh Friendbot-funded wallet — no
// admin secret needed. Deposits underlying into SY Wrapper, splits part of
// it into PT/YT via Tokenizer, then adds PT+SY liquidity to the AMM.
import {
  createWallet,
  fundWallet,
  waitForTransaction,
  assertNotMatured,
  depositVault,
  mintPTYT,
  addLiquidity,
  getServer,
} from '../apps/web/e2e/lib/chain';

async function main() {
  const server = getServer();
  await assertNotMatured(server);

  const wallet = createWallet();
  console.log(`LP wallet: ${wallet.publicKey}`);

  console.log('Funding via Friendbot...');
  await fundWallet(wallet);

  console.log('Depositing 500 XLM into SY Wrapper...');
  const depositResult = await depositVault(wallet, 500);
  await waitForTransaction(depositResult.sendTransactionResponse!.hash!, server);

  console.log('Splitting 200 SY into PT/YT via Tokenizer...');
  const splitResult = await mintPTYT(wallet, 200);
  await waitForTransaction(splitResult.sendTransactionResponse!.hash!, server);

  console.log('Adding liquidity (200 PT + 200 SY) to AMM...');
  const addResult = await addLiquidity(wallet, 200, 200);
  await waitForTransaction(addResult.sendTransactionResponse!.hash!, server);
  console.log(`  add_liquidity tx: ${addResult.sendTransactionResponse!.hash}`);

  console.log('Liquidity seeded.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
