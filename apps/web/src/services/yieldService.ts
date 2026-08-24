import { Vault, YieldHistory } from '../types';
import { ProtocolService } from './protocolService';

export class YieldService {
  /**
   * Helper to unwrap Soroban Result types
   */
  private static unwrapResult(rawResult: unknown): unknown {
    if (rawResult !== undefined && typeof rawResult === 'object' && rawResult !== null) {
      const obj = rawResult as Record<string, unknown>;
      if (typeof obj.unwrap === 'function') return (obj.unwrap as () => unknown)();
      if ('ok' in obj) return obj.ok;
      if ('value' in obj) return obj.value;
    }
    return rawResult;
  }

  static async getActiveMaturityTimestampMs(): Promise<number> {
    // Default to 30 days from now if we can't fetch
    let maturityMs = Date.now() + 30 * 24 * 60 * 60 * 1000;

    try {
      const { Client: TokenizerClient } = await import('../../../../packages/bindings/tokenizer/src/index');
      const { CONTRACTS, RPC_URL, NETWORK_PASSPHRASE } = await import('../config/contracts');

      const tokenizerClient = new TokenizerClient({
        rpcUrl: RPC_URL,
        networkPassphrase: NETWORK_PASSPHRASE,
        contractId: CONTRACTS.TOKENIZER,
      });

      // The new tokenizer's maturity() returns a unix timestamp (seconds) directly —
      // no more ledger-number-to-timestamp conversion via Horizon needed.
      const maturityTx = await tokenizerClient.maturity();
      const maturitySeconds = Number(this.unwrapResult(maturityTx?.result) || 0);
      if (!isNaN(maturitySeconds) && maturitySeconds > 0) {
        maturityMs = maturitySeconds * 1000;
      }
    } catch (e) {
      console.warn("Could not fetch tokenizer maturity", e);
    }
    return maturityMs;
  }

  static async getVaults(): Promise<Vault[]> {
    let tvlUsd = 0;
    let impliedApy = 0;
    try {
      const state = await ProtocolService.getProtocolState();
      tvlUsd = state.tvlUsd;
      impliedApy = state.impliedYieldApy;
    } catch {
      console.warn("Could not fetch live ProtocolState for Vault page");
    }

    const maturityMs = await this.getActiveMaturityTimestampMs();
    const maturityDate = new Date(maturityMs).toISOString();

    return [
      {
        id: 'vault_xlm_01',
        asset: 'XLM',
        protocol: 'Novaire',
        tvlUsd: tvlUsd,
        fixedApy: impliedApy,
        variableApy: 0, // Protocol is currently fixed-yield only
        capacityUsd: 2000000,
        maturityDate: maturityDate,
      }
    ];
  }

  static async getYieldHistory(vaultId: string): Promise<YieldHistory[]> {
    try {
      // Postgres-backed, populated by the indexer's snapshotter — replaces
      // history-store.json for this protocol-level-only read (fixedApy has no
      // wallet-balance dependency, so no need to stay on the file store here).
      const res = await fetch('/api/protocol-history');
      if (!res.ok) return [];
      const history: unknown = await res.json();

      if (!Array.isArray(history)) return [];

      return history.map((h: { timestamp: string; fixedApy?: number }) => ({
        timestamp: new Date(h.timestamp).toISOString(),
        fixedApy: h.fixedApy || 0,
        variableApy: 0, // Protocol is currently fixed-yield only
      }));
    } catch (e) {
      console.warn("Failed to fetch yield history from indexer", e);
      return [];
    }
  }


}
