import testnetDeployments from './deployments.testnet.json';
import mainnetDeployments from './deployments.mainnet.json';

export const NETWORK = (process.env.NEXT_PUBLIC_NETWORK || 'TESTNET').toUpperCase();
const isMainnet = NETWORK === 'MAINNET';

interface Deployments {
  underlying_token?: string;
  sy_wrapper?: string;
  pt_token?: string;
  yt_token?: string;
  tokenizer?: string;
  amm?: string;
}

const deployments: Deployments = isMainnet ? mainnetDeployments : testnetDeployments;

export const CONTRACTS = {
  PT_TOKEN: deployments.pt_token || '',
  YT_TOKEN: deployments.yt_token || '',
  SY_WRAPPER: deployments.sy_wrapper || '',
  TOKENIZER: deployments.tokenizer || '',
  AMM: deployments.amm || '',
  MOCK_USDC: deployments.underlying_token || '',
};

export const RPC_URL = process.env.NEXT_PUBLIC_RPC_URL ||
  (isMainnet ? 'https://mainnet.sorobanrpc.com' : 'https://soroban-testnet.stellar.org');

export const NETWORK_PASSPHRASE = process.env.NEXT_PUBLIC_NETWORK_PASSPHRASE ||
  (isMainnet ? 'Public Global Stellar Network ; September 2015' : 'Test SDF Network ; September 2015');
