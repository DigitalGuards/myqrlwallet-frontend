import { useState, useEffect } from 'react';
import { StorageUtil } from '@/utils/storage';

interface WalletLimitState {
  isWalletLimitReached: boolean;
  walletCount: number;
  maxWallets: number;
  isLoading: boolean;
}

/**
 * Hook to check wallet limit status for a given blockchain.
 * Eliminates duplicated wallet limit checking logic across components.
 */
export function useWalletLimit(blockchain: string | undefined): WalletLimitState {
  const [isWalletLimitReached, setIsWalletLimitReached] = useState(false);
  const [walletCount, setWalletCount] = useState(0);
  const [isLoading, setIsLoading] = useState(true);

  const maxWallets = StorageUtil.getMaxWallets();

  useEffect(() => {
    const checkWalletLimit = async () => {
      if (blockchain) {
        setIsLoading(true);
        const limitReached = await StorageUtil.isWalletLimitReached(blockchain);
        const count = await StorageUtil.getWalletCount(blockchain);
        setIsWalletLimitReached(limitReached);
        setWalletCount(count);
        setIsLoading(false);
      }
    };
    checkWalletLimit();
  }, [blockchain]);

  return { isWalletLimitReached, walletCount, maxWallets, isLoading };
}
