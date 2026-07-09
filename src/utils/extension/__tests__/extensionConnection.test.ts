/**
 * Unit tests for the pure parts of extension discovery: the EIP-6963 rdns
 * allowlist and announcement dedupe. The DOM/event flow and the picker
 * dialog are excluded per repo test policy (components are not jest-run).
 */

import { describe, it, expect } from '@jest/globals';
import {
  dedupeProviders,
  isQrlExtension,
  type EIP6963ProviderDetail,
} from '@/utils/extension/extensionConnection';

const detail = (rdns: string, uuid: string): EIP6963ProviderDetail => ({
  info: { uuid, rdns, name: rdns, icon: 'data:image/svg+xml;base64,' },
  provider: { request: async () => undefined as never },
});

describe('isQrlExtension', () => {
  it('accepts the MyQRLWallet Extension fork', () => {
    expect(isQrlExtension({ rdns: 'com.qrlwallet.extension' })).toBe(true);
  });

  it('accepts the upstream QRL Web3 Wallet', () => {
    expect(isQrlExtension({ rdns: 'theqrl.org' })).toBe(true);
  });

  it('rejects everything else', () => {
    expect(isQrlExtension({ rdns: 'io.metamask' })).toBe(false);
    expect(isQrlExtension({ rdns: 'com.qrlwallet.connect' })).toBe(false);
    expect(isQrlExtension({ rdns: '' })).toBe(false);
  });
});

describe('dedupeProviders', () => {
  it('collapses repeat announcements from the same extension (fresh uuid per announce)', () => {
    const first = detail('com.qrlwallet.extension', 'uuid-1');
    const again = detail('com.qrlwallet.extension', 'uuid-2');
    expect(dedupeProviders([first, again])).toEqual([first]);
  });

  it('keeps distinct extensions in announcement order', () => {
    const fork = detail('com.qrlwallet.extension', 'a');
    const upstream = detail('theqrl.org', 'b');
    expect(dedupeProviders([fork, upstream, fork])).toEqual([fork, upstream]);
  });

  it('handles the empty case', () => {
    expect(dedupeProviders([])).toEqual([]);
  });
});
