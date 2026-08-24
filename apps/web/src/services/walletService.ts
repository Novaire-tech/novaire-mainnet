import {
  isConnected as freighterIsConnected,
  getAddress,
  getNetworkDetails,
  requestAccess
} from '@stellar/freighter-api';
import { NETWORK } from '../config/contracts';

const TARGET_NETWORK = NETWORK === 'MAINNET' ? 'PUBLIC' : 'TESTNET';
const IS_DEV = process.env.NODE_ENV !== 'production';

/** Soroban clients sometimes return Result types wrapped as { unwrap() } / { ok } / { value }. */
function unwrapContractResult(raw: unknown): unknown {
  if (typeof raw === 'object' && raw !== null) {
    const obj = raw as Record<string, unknown>;
    if (typeof obj.unwrap === 'function') return (obj.unwrap as () => unknown)();
    if ('ok' in obj) return obj.ok;
    if ('value' in obj) return obj.value;
  }
  return raw;
}

export interface WalletAssetBalance {
  assetCode: string;
  issuer: string | null;
  amount: string;
  isNative: boolean;
}

export interface WalletConnectionState {
  address: string | null;
  network: string | null;
  error: string | null;
  isConnected: boolean;
  balances: WalletAssetBalance[];
  loading: boolean;
}

export class WalletService {
  private static listeners: Array<() => void> = [];
  
  private static state: WalletConnectionState = {
    address: null,
    network: null,
    error: null,
    isConnected: false,
    balances: [],
    loading: false
  };

  static getState(): WalletConnectionState {
    return this.state;
  }

  static onConnectionChange(callback: () => void) {
    this.listeners.push(callback);
    return () => {
      this.listeners = this.listeners.filter(cb => cb !== callback);
    };
  }

  private static notifyListeners() {
    this.listeners.forEach(cb => cb());
  }

  private static setState(newState: Partial<WalletConnectionState>) {
    this.state = { ...this.state, ...newState };
    this.notifyListeners();
  }

  /**
   * Check if Freighter is installed and available
   */
  static async isAvailable(): Promise<boolean> {
    try {
      const result = await freighterIsConnected();
      return result.isConnected === true;
    } catch {
      return false;
    }
  }

  /**
   * Auto-connect if the user has previously granted permission.
   * Useful to call on application mount.
   */
  static async init(): Promise<void> {
    if (this.state.isConnected) return; // Prevent re-initialization on navigation
    if (this.state.loading) return; // Prevent duplicate initialization
    
    this.setState({ loading: true, error: null });
    
    try {
      const available = await this.isAvailable();
      if (!available) {
        this.setState({ loading: false });
        return;
      }

      const addressData = await getAddress();
      if (addressData && addressData.address) {
        const address = addressData.address;
        const network = await this.getNetwork();
        
        // Enforce network rule even on auto-connect
        if (IS_DEV) console.log(`init() - Result of comparison network !== '${TARGET_NETWORK}':`, network !== TARGET_NETWORK);
        if (network !== TARGET_NETWORK) {
           if (IS_DEV) console.log("init() - Comparison failed because network is:", `"${network}"`, "expected:", `"${TARGET_NETWORK}"`);
           this.setState({ 
             error: `Please switch your Freighter wallet to ${TARGET_NETWORK}.`, 
             isConnected: false, 
             loading: false 
           });
           return;
        }

        this.setState({ address, network, isConnected: true, error: null });
        await this.refreshBalances();
      }
    } catch (e) {
      this.setState({ error: e instanceof Error ? e.message : 'Failed to initialize wallet' });
    } finally {
      this.setState({ loading: false });
    }
  }

  /**
   * Request access to the user's wallet
   */
  static async connectWallet(): Promise<void> {
    this.setState({ loading: true, error: null });

    try {
      const available = await this.isAvailable();
      if (!available) {
        throw new Error('Freighter wallet is not installed or unavailable');
      }

      console.log("3. Freighter permission request started");
      const accessResponse = await requestAccess();
      console.log("4. Freighter returned successfully");
      
      if (accessResponse.error) {
        throw new Error(String(accessResponse.error));
      }

      const address = accessResponse.address || await this.fetchWalletAddress();
      console.log("5. Wallet address returned:", address);
      
      const network = await this.getNetwork();
      console.log("6. Network returned:", network);
      if (IS_DEV) console.log("6. Network returned:", network);

      if (!address) {
        throw new Error('Wallet access rejected or address not found');
      }

      if (IS_DEV) console.log(`Result of comparison network !== '${TARGET_NETWORK}':`, network !== TARGET_NETWORK);
      if (network !== TARGET_NETWORK) {
        if (IS_DEV) console.log("Comparison failed because network is:", `"${network}"`, "expected:", `"${TARGET_NETWORK}"`);
        throw new Error(`Please switch your Freighter wallet to ${TARGET_NETWORK} to continue.`);
      }

      this.setState({
        address,
        network,
        error: null,
        isConnected: true
      });

      // Non-blocking: connected state is visible immediately.
      // Balances (including slow Soroban RPC calls) load in the background.
      this.refreshBalances().catch(err => {
        if (IS_DEV) console.error('Background balance refresh failed:', err);
      });
    } catch (error) {
      if (IS_DEV) console.error("7. Caught error in WalletService.connectWallet:", error);
      this.setState({
        address: null,
        network: null,
        error: error instanceof Error ? error.message : 'Failed to connect wallet',
        isConnected: false
      });
    } finally {
      this.setState({ loading: false });
    }
  }

  /**
   * Disconnect the wallet (client-side state reset)
   */
  static disconnectWallet(): void {
    this.setState({
      address: null,
      network: null,
      error: null,
      isConnected: false,
      balances: []
    });
  }

  private static async fetchWalletAddress(): Promise<string | null> {
    try {
      const response = await getAddress();
      return response.address || null;
    } catch {
      return null;
    }
  }

  /**
   * Get the currently selected network in Freighter
   */
  static async getNetwork(): Promise<string | null> {
    try {
      const response = await getNetworkDetails();
      return response?.network || null;
    } catch {
      return null;
    }
  }

  /**
   * Fetch Native XLM and all other Stellar asset balances from Horizon
   * Internal wrapper that automatically sets state.
   */
  static async refreshBalances(): Promise<void> {
    const { address, network, isConnected } = this.state;
    if (!isConnected || !address) return;

    try {
      if (IS_DEV) {
        console.log("1. Fetching balances for wallet address:", address);
        console.log("2. Detected Stellar network:", network);
      }
      
      let horizonUrl = 'https://horizon.stellar.org';
      if (network === 'TESTNET') {
        horizonUrl = 'https://horizon-testnet.stellar.org';
      } else if (network === 'FUTURENET') {
        horizonUrl = 'https://horizon-futurenet.stellar.org';
      }

      const endpoint = `${horizonUrl}/accounts/${address}`;
      if (IS_DEV) console.log("3. Horizon endpoint being queried:", endpoint);

      const response = await fetch(endpoint);
      if (!response.ok) {
        if (response.status === 404) {
          throw new Error(`Account Not Found: This wallet has not been funded yet. Please send some XLM to this address on ${network} to initialize it.`);
        }
        throw new Error(`Horizon API error: ${response.status}`);
      }

      const data = await response.json();
      console.log("4. Raw JSON response returned by Horizon:", data);
      
      const balances: WalletAssetBalance[] = [];

      if (data.balances && Array.isArray(data.balances)) {
        for (const bal of data.balances) {
          if (bal.asset_type === 'native') {
            balances.push({
              assetCode: 'XLM',
              issuer: null,
              amount: bal.balance,
              isNative: true
            });
          } else {
            balances.push({
              assetCode: bal.asset_code,
              issuer: bal.asset_issuer,
              amount: bal.balance,
              isNative: false
            });
          }
        }
      }

      // Fetch PT and YT balances via Soroban RPC
      try {
        const { Client: PtClient } = await import('../../../../packages/bindings/pt_token/src/index');
        const { Client: YtClient } = await import('../../../../packages/bindings/yt_token/src/index');
        const { CONTRACTS, RPC_URL, NETWORK_PASSPHRASE } = await import('../config/contracts');

        const ptClient = new PtClient({
          contractId: CONTRACTS.PT_TOKEN,
          rpcUrl: RPC_URL,
          networkPassphrase: NETWORK_PASSPHRASE,
          publicKey: address
        });

        const ytClient = new YtClient({
          contractId: CONTRACTS.YT_TOKEN,
          rpcUrl: RPC_URL,
          networkPassphrase: NETWORK_PASSPHRASE,
          publicKey: address
        });

        // Wrap Soroban calls in a 10-second timeout to prevent browser hangs.
        const withTimeout = <T>(p: Promise<T>, ms: number): Promise<T> =>
          Promise.race([
            p,
            new Promise<T>((_, reject) =>
              setTimeout(() => reject(new Error(`Soroban RPC timed out after ${ms}ms`)), ms)
            )
          ]);

        const ptTx = await withTimeout(ptClient.balance({ id: address }), 10000);
        const rawPt = unwrapContractResult(ptTx.result);

        if (rawPt !== undefined) {
          balances.push({
            assetCode: 'PT',
            issuer: CONTRACTS.PT_TOKEN,
            amount: (Number(rawPt) / 1e7).toString(),
            isNative: false
          });
        }

        const ytTx = await withTimeout(ytClient.balance({ id: address }), 10000);
        const rawYt = unwrapContractResult(ytTx.result);

        if (rawYt !== undefined) {
          balances.push({
            assetCode: 'YT',
            issuer: CONTRACTS.YT_TOKEN,
            amount: (Number(rawYt) / 1e7).toString(),
            isNative: false
          });
        }
      } catch (err) {
        console.error("Failed to fetch PT/YT Soroban balances:", err);
      }

      console.log("Parsed balances output:", balances);
      this.setState({ balances });
    } catch (error) {
      console.error('Failed to fetch wallet balances:', error);
      // DO NOT clear balances on refresh error to prevent portfolio value collapse
      this.setState({ error: error instanceof Error ? error.message : 'Failed to refresh balances' });
    }
  }

  // To be used by other services (like portfolioService)
  static async getWalletAddress(): Promise<string | null> {
    return this.state.address;
  }

  static async getBalances(): Promise<WalletAssetBalance[]> {
    return this.state.balances;
  }
}
