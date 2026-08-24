// Reusable, headless (no Freighter) real-testnet transaction helpers for the
// portfolio E2E suite. Uses basicNodeSigner + a raw Keypair, matching the
// established pattern in e2e/_seed-deposits.local.mjs — real Soroban RPC,
// real Friendbot, real contracts. No mocks.
import { Keypair, rpc } from '@stellar/stellar-sdk';
import { basicNodeSigner, ClientOptions } from '@stellar/stellar-sdk/contract';
import { Client as SyWrapperClient } from '../../../../packages/bindings/sy_wrapper/src/index';
import { Client as TokenizerClient } from '../../../../packages/bindings/tokenizer/src/index';
import { Client as AmmClient } from '../../../../packages/bindings/amm/src/index';
import { Client as PtClient } from '../../../../packages/bindings/pt_token/src/index';
import { Client as YtClient } from '../../../../packages/bindings/yt_token/src/index';
import { CONTRACTS, RPC_URL, NETWORK_PASSPHRASE } from '../../src/config/contracts';
import deployments from '../../src/config/deployments.testnet.json';

export const HORIZON_URL = 'https://horizon-testnet.stellar.org';
const FRIENDBOT_URL = 'https://friendbot.stellar.org';
export const STROOP = 10_000_000;

export interface Wallet {
  keypair: Keypair;
  publicKey: string;
}

export function createWallet(): Wallet {
  const keypair = Keypair.random();
  return { keypair, publicKey: keypair.publicKey() };
}

// Friendbot rate-limits aggressively under burst load (5 wallets funded
// back-to-back) — retry with backoff rather than fail the whole run.
export async function fundWallet(wallet: Wallet, retries = 5): Promise<void> {
  for (let attempt = 1; attempt <= retries; attempt++) {
    const res = await fetch(`${FRIENDBOT_URL}?addr=${encodeURIComponent(wallet.publicKey)}`);
    if (res.ok || res.status === 400) {
      // 400 = already funded, treat as success.
      await waitForAccountOnHorizon(wallet.publicKey);
      return;
    }
    if (res.status === 429 && attempt < retries) {
      await new Promise((r) => setTimeout(r, attempt * 2000));
      continue;
    }
    throw new Error(`Friendbot funding failed for ${wallet.publicKey}: ${res.status} ${await res.text()}`);
  }
  throw new Error(`Friendbot funding exhausted retries for ${wallet.publicKey}`);
}

async function waitForAccountOnHorizon(publicKey: string, timeoutMs = 30_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const res = await fetch(`${HORIZON_URL}/accounts/${publicKey}`);
    if (res.ok) return;
    await new Promise((r) => setTimeout(r, 1500));
  }
  throw new Error(`Timed out waiting for account ${publicKey} to appear on Horizon`);
}

export async function waitForLedger(targetSequence: number, server: rpc.Server, timeoutMs = 60_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const latest = await server.getLatestLedger();
    if (latest.sequence >= targetSequence) return;
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw new Error(`Timed out waiting for ledger ${targetSequence}`);
}

export async function waitForTransaction(hash: string, server: rpc.Server, timeoutMs = 60_000): Promise<rpc.Api.GetTransactionResponse> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = await server.getTransaction(hash);
    if (result.status !== 'NOT_FOUND') return result;
    await new Promise((r) => setTimeout(r, 1500));
  }
  throw new Error(`Timed out waiting for transaction ${hash}`);
}

function clientFor<T extends new (opts: ClientOptions) => InstanceType<T>>(Ctor: T, contractId: string, wallet: Wallet) {
  const signer = basicNodeSigner(wallet.keypair, NETWORK_PASSPHRASE);
  return new Ctor({
    contractId,
    rpcUrl: RPC_URL,
    networkPassphrase: NETWORK_PASSPHRASE,
    publicKey: wallet.publicKey,
    ...signer,
  });
}

export function getServer(): rpc.Server {
  return new rpc.Server(RPC_URL, { allowHttp: true });
}

/**
 * The new tokenizer reports maturity() as a unix timestamp (seconds), not a ledger
 * number — deployments.testnet.json no longer carries a maturity_ledger field, so this
 * reads maturity live off the Tokenizer contract instead.
 */
// rpc.Server.getAccountEntry requires the source account to actually exist
// on-chain, even for a pure read-only simulation. A freshly random keypair
// is never funded, so it always threw "Account not found" here — which the
// caller's broad catch then misreported as "matured", skipping the whole
// suite. Use the deployer's address instead: it's the same real, funded,
// public (not secret) account published in deployments/testnet.toml and
// wired into the frontend as NEXT_PUBLIC_SIMULATION_SOURCE_ADDRESS for this
// exact purpose.
const READ_ONLY_SIMULATION_ADDRESS = 'GAOFWNGYDQ5FEL7SDCGA7VHP2EP6RIMDWR3HN3FYQTES3LSVBZI4DK6D';

export async function assertNotMatured(_server: rpc.Server) {
  const readOnlyWallet: Wallet = { keypair: Keypair.random(), publicKey: READ_ONLY_SIMULATION_ADDRESS };
  const client = clientFor(TokenizerClient, CONTRACTS.TOKENIZER, readOnlyWallet);
  const tx = await client.maturity();
  const raw = tx.result as unknown;
  const unwrapped = raw && typeof raw === 'object' && typeof (raw as Record<string, unknown>).unwrap === 'function'
    ? ((raw as Record<string, unknown>).unwrap as () => unknown)()
    : raw;
  const maturitySeconds = Number(unwrapped);
  const nowSeconds = Date.now() / 1000;
  if (nowSeconds >= maturitySeconds) {
    throw new Error(
      `Testnet fixture matured (now ${nowSeconds} >= maturity ${maturitySeconds}) — redeploy before running portfolio E2E.`,
    );
  }
  return { nowSeconds, maturity: maturitySeconds };
}

/** Deposits `amountXlm` directly into the SY Wrapper, minting raw (unsplit) SY shares. */
export async function depositVault(wallet: Wallet, amountXlm: number) {
  const client = clientFor(SyWrapperClient, CONTRACTS.SY_WRAPPER, wallet);
  const amount = BigInt(Math.floor(amountXlm * STROOP));
  const tx = await client.deposit({ from: wallet.publicKey, amount });
  return tx.signAndSend();
}

/** Splits `syShares` of a user's SY balance into PT + YT via the Tokenizer. */
export async function mintPTYT(wallet: Wallet, syShares: number) {
  const client = clientFor(TokenizerClient, CONTRACTS.TOKENIZER, wallet);
  const shares = BigInt(Math.floor(syShares * STROOP));
  const tx = await client.split({ from: wallet.publicKey, sy_amount: shares });
  return tx.signAndSend();
}

/**
 * Acquires PT the same way an end user buying on the secondary market would:
 * deposits underlying (XLM) into the SY Wrapper, then swaps the resulting SY
 * for PT against the AMM. This is economically independent of any SY
 * deposit/split the same wallet may also hold — see the P1 precedence fix in
 * portfolioService.ts.
 */
export async function buyPT(wallet: Wallet, underlyingInXlm: number, minPtOut = 0n) {
  const syClient = clientFor(SyWrapperClient, CONTRACTS.SY_WRAPPER, wallet);
  const underlying_in = BigInt(Math.floor(underlyingInXlm * STROOP));
  const depositTx = await syClient.deposit({ from: wallet.publicKey, amount: underlying_in });
  await depositTx.signAndSend();

  const ammClient = clientFor(AmmClient, CONTRACTS.AMM, wallet);
  const tx = await ammClient.swap_sy_for_pt({ from: wallet.publicKey, sy_in: underlying_in, min_pt_out: minPtOut });
  return tx.signAndSend();
}

/** Seeds AMM liquidity from a wallet's own SY/PT balances (e.g. after depositVault + mintPTYT). */
export async function addLiquidity(wallet: Wallet, ptIn: number, syIn: number, minLpOut = 0n) {
  const client = clientFor(AmmClient, CONTRACTS.AMM, wallet);
  const tx = await client.add_liquidity({
    from: wallet.publicKey,
    pt_in: BigInt(Math.floor(ptIn * STROOP)),
    sy_in: BigInt(Math.floor(syIn * STROOP)),
    min_lp_out: minLpOut,
  });
  return tx.signAndSend();
}

/** Redeems raw (unsplit) SY shares back to underlying via the SY Wrapper. */
export async function redeem(wallet: Wallet, shares: number) {
  const client = clientFor(SyWrapperClient, CONTRACTS.SY_WRAPPER, wallet);
  const sharesAmount = BigInt(Math.floor(shares * STROOP));
  const tx = await client.redeem({ from: wallet.publicKey, sy_amount: sharesAmount });
  return tx.signAndSend();
}

/**
 * Reads the wallet's currently accrued (claimable) yield off the YT contract.
 * Actual claiming is a tokenizer.claim_yield(holder) mutating call, not
 * exposed here — this helper only reads the current accrued balance.
 */
export async function claimYield(wallet: Wallet) {
  const client = clientFor(YtClient, CONTRACTS.YT_TOKEN, wallet);
  const tx = await client.accrued_yield({ holder: wallet.publicKey });
  return tx; // read-only simulate call; see NOTE above
}

export async function readOnChainState(publicKey: string) {
  const readOnlyWallet: Wallet = { keypair: Keypair.random(), publicKey };
  const syWrapperClient = clientFor(SyWrapperClient, CONTRACTS.SY_WRAPPER, readOnlyWallet);
  const ptClient = clientFor(PtClient, CONTRACTS.PT_TOKEN, readOnlyWallet);
  const ytClient = clientFor(YtClient, CONTRACTS.YT_TOKEN, readOnlyWallet);
  const ammClient = clientFor(AmmClient, CONTRACTS.AMM, readOnlyWallet);

  const [syTx, ptTx, ytTx, claimableTx, ptQuoteTx] = await Promise.all([
    syWrapperClient.balance({ id: publicKey }),
    ptClient.balance({ id: publicKey }),
    ytClient.balance({ id: publicKey }),
    ytClient.accrued_yield({ holder: publicKey }),
    ammClient.quote_pt_for_sy({ pt_in: BigInt(STROOP) }),
  ]);

  const unwrap = (r: { result?: unknown } | undefined) => {
    let v: unknown = r?.result;
    if (v && typeof v === 'object') {
      const obj = v as Record<string, unknown>;
      if (typeof obj.unwrap === 'function') v = (obj.unwrap as () => unknown)();
      else if ('ok' in obj) v = obj.ok;
      else if ('value' in obj) v = obj.value;
    }
    const n = Number(v);
    return isNaN(n) ? 0 : n;
  };

  return {
    vaultLp: unwrap(syTx) / STROOP,
    ptBalance: unwrap(ptTx) / STROOP,
    ytBalance: unwrap(ytTx) / STROOP,
    claimableYield: unwrap(claimableTx) / STROOP,
    // Quote 1 PT -> SY; underlying-denominated price would additionally need the
    // SY Wrapper's exchange rate, but callers of this E2E helper only compare
    // this value relatively, so the SY-denominated quote is left as-is.
    ptPriceUnderlying: unwrap(ptQuoteTx) / STROOP,
  };
}

export { deployments };
