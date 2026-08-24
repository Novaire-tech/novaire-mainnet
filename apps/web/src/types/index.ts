export interface Portfolio {
  totalBalanceUsd: number;
  totalYieldEarnedUsd: number;
  averageApy: number;
}

export interface Position {
  id: string;
  vaultId: string;
  asset: string;
  amount: number;
  valueUsd: number;
  yieldType: 'fixed' | 'variable';
  apy: number;
  maturityDate?: string;
  createdAt: string;
}

export interface Vault {
  id: string;
  asset: string;
  protocol: string;
  tvlUsd: number;
  fixedApy: number;
  variableApy: number;
  capacityUsd: number;
  maturityDate: string;
}

export interface Activity {
  id: string;
  type: 'deposit' | 'withdraw' | 'claim';
  asset: string;
  amount: number;
  valueUsd: number;
  timestamp: string;
  txHash: string;
  status: 'pending' | 'completed' | 'failed';
}

export interface ProtocolMetrics {
  tvlUsd: number;
  totalVolumeUsd: number;
  activeUsers: number;
  totalYieldGeneratedUsd: number;
}

export interface PriceData {
  asset: string;
  priceUsd: number;
  change24h: number;
  sparkline: number[];
}

export interface WalletBalance {
  asset: string;
  amount: number;
  valueUsd: number;
  priceUsd: number;
}

export interface YieldHistory {
  timestamp: string;
  fixedApy: number;
  variableApy: number;
}
