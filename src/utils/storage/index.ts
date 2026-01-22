export {
  default as StorageUtil,
  type AccountSource,
  type AccountListItem,
  type EncryptedSeedData,
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
