/**
 * Unit tests for the web fragment ingress parser: the #qrlconnect= handoff
 * a dApp's "Open web wallet" link leaves in location.hash.
 *
 * DAppConnectService is mocked at the module seam for the same reason as in
 * dappConnectStore.test.ts: its real module transitively imports the wallet
 * store graph, which jest's node runtime cannot load. The mock mirrors the
 * real one-line scheme regex.
 */

import { describe, it, expect, jest } from '@jest/globals';

jest.mock('@/services/dappConnect/DAppConnectService', () => {
  class DAppConnectService {
    static isConnectionURI(uri: string): boolean {
      return /^qrlconnect:/i.test(uri);
    }
  }
  return { DAppConnectService };
});

import {
  extractPairingUriFromFragment,
  fragmentHasPairingKey,
} from '@/services/dappConnect/fragmentIngress';

// Payload with URI-hostile characters: its own query params (&), a literal
// %25 / %26, and a + that must survive the round trip un-mangled.
const URI = 'qrlconnect://?q=blob%25data&r=https://relay.example/path?a=1&b=2&plus=1+1&pct=%26';

describe('extractPairingUriFromFragment', () => {
  it('round-trips an encodeURIComponent-encoded URI without double-decoding', () => {
    expect(extractPairingUriFromFragment(`#qrlconnect=${encodeURIComponent(URI)}`)).toBe(URI);
  });

  it('finds the key among other fragment params', () => {
    const hash = `#foo=1&qrlconnect=${encodeURIComponent(URI)}&bar=2`;
    expect(extractPairingUriFromFragment(hash)).toBe(URI);
  });

  it('accepts input without the leading #', () => {
    expect(extractPairingUriFromFragment(`qrlconnect=${encodeURIComponent(URI)}`)).toBe(URI);
  });

  it.each([['', 'empty string'], ['#', 'bare hash'], ['#foo=1', 'no qrlconnect key']])(
    'returns null for %s (%s)',
    (hash) => {
      expect(extractPairingUriFromFragment(hash)).toBeNull();
    }
  );

  it('returns null for a non-qrlconnect value', () => {
    const hash = `#qrlconnect=${encodeURIComponent('https://evil.example/?q=x')}`;
    expect(extractPairingUriFromFragment(hash)).toBeNull();
  });
});

describe('fragmentHasPairingKey', () => {
  it('is true even when the value is invalid (so the caller still scrubs it)', () => {
    expect(fragmentHasPairingKey('#qrlconnect=junk')).toBe(true);
  });

  it('is false when the key is absent', () => {
    expect(fragmentHasPairingKey('#foo=1&bar=2')).toBe(false);
    expect(fragmentHasPairingKey('')).toBe(false);
  });
});
