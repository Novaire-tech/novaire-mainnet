import StellarHDWallet from 'stellar-hd-wallet';

const HORIZON_URL = 'https://horizon-testnet.stellar.org';
const FRIENDBOT_URL = 'https://friendbot.stellar.org';

export interface FundedTestnetAccount {
  publicKey: string;
  // Freighter's "I already have a wallet" import screen only accepts a
  // BIP-39 mnemonic (SEP-0005 derivation, account index 0) — not a raw
  // secret key — so that's what onboardFreighter() needs.
  mnemonic: string;
}

async function fundViaFriendbot(publicKey: string): Promise<void> {
  const res = await fetch(`${FRIENDBOT_URL}?addr=${encodeURIComponent(publicKey)}`);
  // Friendbot 400s if the account is already funded — not a real failure.
  if (!res.ok && res.status !== 400) {
    throw new Error(`Friendbot funding failed: ${res.status} ${await res.text()}`);
  }
}

async function waitForAccount(publicKey: string, timeoutMs = 30_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const res = await fetch(`${HORIZON_URL}/accounts/${publicKey}`);
    if (res.ok) return;
    await new Promise((resolve) => setTimeout(resolve, 1_500));
  }
  throw new Error(`Timed out waiting for testnet account ${publicKey} to appear on Horizon`);
}

// Generates a fresh 12-word mnemonic (matching Freighter's default "12 word"
// import mode) and funds its account-0 address via Friendbot, so the
// real-wallet e2e test never depends on a long-lived secret checked into
// the environment.
export async function createFundedTestnetAccount(): Promise<FundedTestnetAccount> {
  const mnemonic = StellarHDWallet.generateMnemonic({ entropyBits: 128 });
  const wallet = StellarHDWallet.fromMnemonic(mnemonic);
  const publicKey = wallet.getPublicKey(0);
  await fundViaFriendbot(publicKey);
  await waitForAccount(publicKey);
  return { publicKey, mnemonic };
}
