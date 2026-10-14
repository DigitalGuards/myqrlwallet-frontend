import type { BlockchainSelection } from "@/utils/storage/storage";
import { useState, useEffect } from 'react';
import { StorageUtil } from '@/utils/storage';
import { logger } from '@/utils/log';

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
export function useWalletLimit(blockchain: BlockchainSelection | undefined): WalletLimitState {
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
    checkWalletLimit().catch((error: unknown) => {
      logger.error('Failed to check wallet limit:', error);
    });
  }, [blockchain]);

  return { isWalletLimitReached, walletCount, maxWallets, isLoading };
}
