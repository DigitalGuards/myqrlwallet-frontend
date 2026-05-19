export {
  default as StorageUtil,
  type AccountSource,
  type AccountListItem,
  type EncryptedSeedData,
  STORAGE_EVENT_ACTIVE_ACCOUNT,
  STORAGE_EVENT_WALLET_SETTINGS,
} from './storage';

export {
  hasActiveWallet,
  startAutoLockTimer,
  clearAutoLockTimer,
  updateLastActivity,
  restartAutoLockTimer,
  checkAndStartAutoLock,
  setupActivityTracking,
} from './autoLock';
