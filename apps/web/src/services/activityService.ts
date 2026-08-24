import { NETWORK } from '../config/contracts';

const IS_DEV = process.env.NODE_ENV !== 'production';
const isMainnet = NETWORK === 'MAINNET';
const HORIZON_URL = isMainnet ? 'https://horizon.stellar.org' : 'https://horizon-testnet.stellar.org';
const EXPLORER_NETWORK = isMainnet ? 'public' : 'testnet';

export interface UIActivity {
  id: string;
  type: string;
  vault: string;
  amount: string;
  time: string;
  txHash?: string;
  explorerUrl?: string;
  details?: string[];
}

interface HorizonAssetBalanceChange {
  type: string;
  from?: string;
  to?: string;
  amount: string;
  asset_type: string;
  asset_code?: string;
}

interface HorizonSymParameter {
  type: string;
  value?: string;
}

interface HorizonOperationRecord {
  id: string;
  type: string;
  transaction_hash?: string;
  created_at: string;
  parameters?: HorizonSymParameter[];
  asset_balance_changes?: HorizonAssetBalanceChange[];
  asset_type?: string;
  asset_code?: string;
  to?: string;
  from?: string;
  amount?: string;
  starting_balance?: string;
}

// Known Soroban event topic substrings → human-readable labels
const TOPIC_LABELS: Record<string, { type: string; vault: string }> = {
  'execute_fyi':       { type: 'Minted PT & YT',            vault: 'Novaire Intent Engine' },
  'swap_u_pt':         { type: 'Swapped XLM → PT',          vault: 'Novaire Marketplace' },
  'swap_pt_u':         { type: 'Swapped PT → XLM',          vault: 'Novaire Marketplace' },
  'swap_u_yt':         { type: 'Swapped XLM → YT',          vault: 'Novaire Marketplace' },
  'swap_yt_u':         { type: 'Swapped YT → XLM',          vault: 'Novaire Marketplace' },
  'deposit':           { type: 'Deposited to Vault',         vault: 'Novaire Vault' },
  'withdraw':          { type: 'Withdrew from Vault',        vault: 'Novaire Vault' },
  'provide_liquidity': { type: 'Added Liquidity',            vault: 'Novaire Marketplace' },
  'redeem_pt':         { type: 'Redeemed PT at Maturity',   vault: 'Novaire Vault' },
  'intent':            { type: 'Minted PT & YT',            vault: 'Novaire Intent Engine' },
  'execute':           { type: 'Protocol Execution',        vault: 'Novaire Protocol' },
};

function formatTimeAgo(isoDate: string): string {
  const txDate = new Date(isoDate);
  const diffMs = Date.now() - txDate.getTime();
  const diffSecs = Math.floor(diffMs / 1000);
  const diffMins = Math.floor(diffSecs / 60);
  const diffHrs = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHrs / 24);
  if (diffSecs < 60) return `${diffSecs}s ago`;
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHrs < 24) return `${diffHrs}h ago`;
  return `${diffDays}d ago`;
}

export class ActivityService {
  static async getActivityHistory(walletAddress: string): Promise<UIActivity[]> {
    try {
      // Fetch recent operations directly from Stellar Horizon (last 20)
      const res = await fetch(
        `${HORIZON_URL}/accounts/${walletAddress}/operations?limit=20&order=desc`
      );
      if (!res.ok) return [];
      const data = await res.json();

      const activities: UIActivity[] = [];
      const records: HorizonOperationRecord[] = data._embedded?.records || [];

      for (const record of records) {
        let type = 'Contract Interaction';
        let amount = '---';
        let vault = 'Stellar Network';
        let fnName = '';
        let details: string[] | undefined = undefined;
        const txHash: string = record.transaction_hash || '';
        const explorerUrl = txHash
          ? `https://stellar.expert/explorer/${EXPLORER_NETWORK}/tx/${txHash}`
          : undefined;

        if (record.type === 'invoke_host_function') {
          // Default for unrecognised contract calls
          type = 'Smart Contract Execution';
          vault = 'Novaire Epoch 17';

          // Try to identify the specific Novaire function by decoding Sym parameters
          const params: HorizonSymParameter[] = record.parameters ?? [];
          for (const param of params) {
            if (param.type === 'Sym' && param.value) {
              try {
                // Decode base64 to ASCII and remove null bytes
                const decoded = atob(param.value).replace(/\0/g, '');
                if (IS_DEV) console.log("Decoded topic:", decoded);
                if (decoded.length > 3) {
                  fnName += decoded.toLowerCase();
                }
              } catch {
                // Ignore base64 decode errors
              }
            }
          }

          for (const [topic, label] of Object.entries(TOPIC_LABELS)) {
            if (fnName.includes(topic.toLowerCase())) {
              type = label.type;
              vault = label.vault;
              break;
            }
          }

          const changes: HorizonAssetBalanceChange[] = record.asset_balance_changes ?? [];
          details = [];

          if (fnName.includes('execute_fixed_yield_intent') || fnName.includes('execute_fyi')) {
            type = 'Minted PT & YT';
            vault = 'Novaire Intent Engine';
            
            // Try to find XLM deposited from balance changes
            let depositedXlm = '---';
            const userDebit = changes.find((c) => c.type === 'transfer' && c.from === walletAddress && c.asset_type === 'native');
            if (userDebit) depositedXlm = parseFloat(userDebit.amount).toFixed(2);

            details.push(`Deposited ${depositedXlm} XLM`);
            details.push('Received PT');
            details.push('Sold YT');
            details.push('Fixed APY');
            amount = `+${depositedXlm} XLM`;
          } else if (changes.length > 0) {
            // Generic fallback for other recognized operations
            const credited = changes.find((c) => (c.type === 'credit' || (c.type === 'transfer' && c.to === walletAddress)));
            const debited  = changes.find((c) => (c.type === 'debit' || (c.type === 'transfer' && c.from === walletAddress)));
            if (credited) {
              const code = credited.asset_type === 'native' ? 'XLM' : (credited.asset_code || 'Tokens');
              amount = `+${parseFloat(credited.amount).toFixed(4)} ${code}`;
            } else if (debited) {
              const code = debited.asset_type === 'native' ? 'XLM' : (debited.asset_code || 'Tokens');
              amount = `-${parseFloat(debited.amount).toFixed(4)} ${code}`;
            }
          }

        } else if (record.type === 'payment') {
          type = 'Transfer';
          const assetCode = record.asset_type === 'native' ? 'XLM' : record.asset_code;
          const dir = record.to === walletAddress ? '+' : '-';
          const parsed = parseFloat(record.amount || '');
          amount = `${dir}${isNaN(parsed) ? '?' : parsed.toFixed(4)} ${assetCode}`;
          vault = record.to === walletAddress ? 'Received' : 'Sent';

        } else if (record.type === 'create_account') {
          type = 'Account Funded';
          const bal = parseFloat(record.starting_balance || '');
          amount = `+${isNaN(bal) ? '?' : bal.toFixed(4)} XLM`;
          vault = 'Stellar Network';

        } else if (record.type === 'change_trust') {
          type = 'Trustline';
          vault = record.asset_code ?? 'Asset';
        }

        activities.push({
          id: record.id,
          type,
          vault,
          amount,
          time: formatTimeAgo(record.created_at),
          txHash: txHash || undefined,
          explorerUrl,
          details: details && details.length > 0 ? details : undefined,
        });
      }

      return activities;
    } catch (e) {
      if (IS_DEV) console.error('Failed to fetch activity from Horizon:', e);
      return [];
    }
  }
}
