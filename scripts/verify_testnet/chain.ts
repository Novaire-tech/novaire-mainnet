// Real-testnet helpers for scripts/verify-testnet.ts. Thin wrapper around
// apps/web/e2e/lib/chain.ts — the single source of truth for real-testnet
// transaction helpers against the current architecture (SY Wrapper ->
// Tokenizer -> PT/YT -> AMM). Adds only the pieces verify-testnet.ts needs
// that the E2E lib doesn't already provide (retry/backoff wrappers,
// deterministic wallets for reproducible local runs, network constants).
import { Keypair, rpc, Contract, TransactionBuilder, BASE_FEE, nativeToScVal, scValToNative, xdr } from '@stellar/stellar-sdk';
import { basicNodeSigner, ClientOptions } from '@stellar/stellar-sdk/contract';
import { Client as SyWrapperClient } from '../../packages/bindings/sy_wrapper/src/index';
import { Client as AmmClient } from '../../packages/bindings/amm/src/index';
import {
  createWallet,
  fundWallet,
  getServer,
  waitForTransaction,
  assertNotMatured as assertNotMaturedBase,
  depositVault as depositVaultBase,
  mintPTYT as mintPTYTBase,
  buyPT as buyPTBase,
  addLiquidity as addLiquidityBase,
  redeem as redeemBase,
  readOnChainState as readOnChainStateBase,
  type Wallet,
} from '../../apps/web/e2e/lib/chain';
import { RPC_URL, NETWORK_PASSPHRASE, CONTRACTS } from '../../apps/web/src/config/contracts';
import deployments from '../../apps/web/src/config/deployments.testnet.json';

// The Blend pool this deployment's SY Wrapper is wired to
// (deployments/testnet.toml: `blend_pool`). Not surfaced in
// deployments.testnet.json / CONTRACTS since the frontend never talks to
// Blend directly — only the SY Wrapper contract does. There is no generated
// TS client for Blend (no `blend-contract-sdk` binding in this repo, by the
// same SDK-version-mismatch decision documented in
// contracts/blend-adapter/src/lib.rs), so reads below go through a raw
// Contract().call() + simulateTransaction, the same shape the deleted scripts/read_tokenizer.ts used.
export const BLEND_POOL = 'CCEBVDYM32YNYCVNRXQKDFFPISJJCV557CDZEIRBEE4NCV4KHPQ44HGF';
export const UNDERLYING_ASSET = deployments.underlying_token;

export { RPC_URL, NETWORK_PASSPHRASE };
export const HORIZON_URL = 'https://horizon-testnet.stellar.org';
export const FRIENDBOT_URL = 'https://friendbot.stellar.org';
export const STROOP = 10_000_000;

export type { Wallet };
export { createWallet, fundWallet, getServer, waitForTransaction };

export interface TxOutcome {
  hash?: string;
  status: string;
}

function normalize(result: { sendTransactionResponse?: { hash?: string }; getTransactionResponse?: { status?: string } }): TxOutcome {
  return {
    hash: result?.sendTransactionResponse?.hash,
    status: result?.getTransactionResponse?.status ?? 'submitted',
  };
}

export async function depositVault(wallet: Wallet, amountXlm: number): Promise<TxOutcome> {
  return normalize(await depositVaultBase(wallet, amountXlm));
}

export async function mintPTYT(wallet: Wallet, syShares: number): Promise<TxOutcome> {
  return normalize(await mintPTYTBase(wallet, syShares));
}

export async function buyPT(wallet: Wallet, underlyingInXlm: number): Promise<TxOutcome> {
  return normalize(await buyPTBase(wallet, underlyingInXlm));
}

export async function addLiquidity(wallet: Wallet, ptIn: number, syIn: number): Promise<TxOutcome> {
  return normalize(await addLiquidityBase(wallet, ptIn, syIn));
}

export async function redeem(wallet: Wallet, shares: number): Promise<TxOutcome> {
  return normalize(await redeemBase(wallet, shares));
}

// The Soroban RPC client's fetch adapter intermittently throws a bare
// "fetch failed" on some networks even when the endpoint is reachable
// (verified: plain `fetch()` to the same URL succeeds on the same retry
// where the SDK's axios-based adapter doesn't) — transient, not a code bug.
// Wraps read-only/pre-submission calls so a single flaky attempt doesn't
// fail the whole run. Not applied after a transaction is already
// broadcast, to avoid retrying into a double-submit.
export async function withRetry<T>(fn: () => Promise<T>, retries = 4, label = 'RPC call'): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      if (attempt < retries) await new Promise((r) => setTimeout(r, attempt * 1500));
    }
  }
  throw new Error(`${label} failed after ${retries} attempts: ${(lastErr as any)?.message || lastErr}`);
}

/** Deterministic wallet derived from a fixed seed string, for reproducible local runs. */
export function deterministicWallet(seed: string): Wallet {
  const bytes = Buffer.alloc(32);
  for (let i = 0; i < seed.length; i++) bytes[i % 32] ^= seed.charCodeAt(i) + i;
  const keypair = Keypair.fromRawEd25519Seed(bytes);
  return { keypair, publicKey: keypair.publicKey() };
}

/**
 * A tx reaching SUCCESS via getTransaction() doesn't guarantee the RPC
 * node's own account/contract-state view (used by the next simulate() call)
 * has caught up yet — observed "Account not found" on a state read
 * immediately following a confirmed deposit even though Horizon already
 * showed the account funded. Call after waitForTransaction() before reading
 * state that depends on the just-confirmed tx's effects.
 */
export async function settleAfterConfirmation(ms = 3000): Promise<void> {
  await new Promise((r) => setTimeout(r, ms));
}

export async function assertNotMatured(server: rpc.Server): Promise<void> {
  await assertNotMaturedBase(server);
}

export interface OnChainState {
  vaultLp: number;
  ptBalance: number;
  ytBalance: number;
  claimableYield: number;
  ptPriceUnderlying: number;
}

/** Reads every balance directly from the deployed contracts — never from the app. */
export async function readOnChainState(publicKey: string): Promise<OnChainState> {
  return withRetry(() => readOnChainStateBase(publicKey), 4, 'readOnChainState');
}

/**
 * KNOWN LIMITATION: yt_token has no user-callable claim-and-pay-out
 * transaction in this contract version — accrued_yield() is read-only, and
 * accrual is admin/epoch-driven. This script therefore cannot manufacture
 * nonzero claimable yield for a fresh wallet; the Claimable Yield scenario
 * verifies the safe-math (no Infinity/NaN) path unconditionally, and
 * additionally checks the nonzero-conversion path if
 * VERIFY_YIELD_WALLET_SECRET points at a wallet that already has accrued
 * yield.
 */
export async function readClaimableYield(publicKey: string): Promise<number> {
  const state = await readOnChainState(publicKey);
  return state.claimableYield;
}

/**
 * Simulates a read-only call against an arbitrary deployed contract (used
 * for the Blend pool, which has no generated TS client in this repo). The
 * source account only needs to exist on-chain for the simulation footprint —
 * it is never a real submission — so any funded wallet works.
 */
async function simulateRawCall(contractId: string, method: string, args: xdr.ScVal[], sourcePublicKey: string): Promise<unknown> {
  const server = getServer();
  const account = await withRetry(() => server.getAccount(sourcePublicKey), 4, `getAccount(${sourcePublicKey})`);
  const contract = new Contract(contractId);
  const tx = new TransactionBuilder(account, { fee: BASE_FEE, networkPassphrase: NETWORK_PASSPHRASE })
    .addOperation(contract.call(method, ...args))
    .setTimeout(30)
    .build();
  const sim = await withRetry(() => server.simulateTransaction(tx), 4, `simulate(${method})`);
  if (!rpc.Api.isSimulationSuccess(sim)) {
    throw new Error(`simulate(${method}) on ${contractId} failed: ${JSON.stringify(sim)}`);
  }
  if (!sim.result?.retval) throw new Error(`simulate(${method}) on ${contractId} returned no retval`);
  return scValToNative(sim.result.retval);
}

export interface BlendReserve {
  index: number;
  enabled: boolean;
  bRate: bigint;
}

/** Reads the Blend pool's reserve for `asset` (`get_reserve`) — real pool state, not a mock. */
export async function readBlendReserve(asset: string, sourcePublicKey: string): Promise<BlendReserve> {
  const raw = (await simulateRawCall(
    BLEND_POOL,
    'get_reserve',
    [nativeToScVal(asset, { type: 'address' })],
    sourcePublicKey,
  )) as { config: { index: number; enabled: boolean }; data: { b_rate: bigint } };
  return {
    index: Number(raw.config.index),
    enabled: Boolean(raw.config.enabled),
    bRate: BigInt(raw.data.b_rate),
  };
}

/** Reads the wrapper's live bToken position in the Blend pool (`get_positions`). */
export async function readBlendPositions(holder: string, sourcePublicKey: string): Promise<Map<number, bigint>> {
  const raw = (await simulateRawCall(
    BLEND_POOL,
    'get_positions',
    [nativeToScVal(holder, { type: 'address' })],
    sourcePublicKey,
  )) as { supply: Map<number, bigint> | Record<string, bigint> };
  const supply = raw.supply;
  if (supply instanceof Map) return supply;
  return new Map(Object.entries(supply).map(([k, v]) => [Number(k), BigInt(v)]));
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

function unwrapResult(v: unknown): unknown {
  if (v && typeof v === 'object') {
    const obj = v as Record<string, unknown>;
    if (typeof obj.unwrap === 'function') return (obj.unwrap as () => unknown)();
    if ('ok' in obj) return obj.ok;
    if ('value' in obj) return obj.value;
  }
  return v;
}

/** Reads the SY Wrapper's on-chain exchange_rate() (WAD, 18-decimal). Real contract read, via generated client. */
export async function readSyExchangeRate(sourcePublicKey: string): Promise<bigint> {
  const readOnlyWallet: Wallet = { keypair: Keypair.random(), publicKey: sourcePublicKey };
  const client = clientFor(SyWrapperClient, CONTRACTS.SY_WRAPPER, readOnlyWallet);
  const tx = await client.exchange_rate();
  return BigInt(unwrapResult(tx.result) as bigint);
}

/** Reads the SY Wrapper's on-chain total_supply() (7-decimal shares). */
export async function readSyTotalSupply(sourcePublicKey: string): Promise<bigint> {
  const readOnlyWallet: Wallet = { keypair: Keypair.random(), publicKey: sourcePublicKey };
  const client = clientFor(SyWrapperClient, CONTRACTS.SY_WRAPPER, readOnlyWallet);
  const tx = await client.total_supply();
  return BigInt(unwrapResult(tx.result) as bigint);
}

/** Reads the AMM's on-chain spot_apy() (bps). */
export async function readAmmSpotApy(sourcePublicKey: string): Promise<bigint> {
  const readOnlyWallet: Wallet = { keypair: Keypair.random(), publicKey: sourcePublicKey };
  const client = clientFor(AmmClient, CONTRACTS.AMM, readOnlyWallet);
  const tx = await client.spot_apy();
  return BigInt(unwrapResult(tx.result) as bigint);
}
