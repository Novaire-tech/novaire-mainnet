import { useEffect, useSyncExternalStore } from 'react';
import { WalletService } from '../services/walletService';

export function useWallet() {
  const state = useSyncExternalStore(
    WalletService.onConnectionChange.bind(WalletService),
    WalletService.getState.bind(WalletService),
    WalletService.getState.bind(WalletService)
  );

  useEffect(() => {
    // Automatically try to reconnect when the hook is first used
    WalletService.init();
  }, []);

  return {
    ...state,
    connect: async () => {
      try {
        await WalletService.connectWallet();
      } catch (e) {
        console.error("Failed to connect wallet:", e);
      }
    },
    disconnect: () => WalletService.disconnectWallet(),
    refreshBalances: () => WalletService.refreshBalances()
  };
}
