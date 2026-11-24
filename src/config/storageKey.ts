/**
 * The storage key for a wallet profile. No imports: the build config uses it
 * before any define exists, and runtimeProfile.ts uses it at run time.
 */
export const storageKeyForProfile = (isV3: boolean, key: string): string =>
  isV3 ? `qrlwallet:v3:${key}` : key;
