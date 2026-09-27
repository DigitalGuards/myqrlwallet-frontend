/**
 * Unit tests for the desktop bridge's pure logic: buildDappOrigin, the
 * sanitiser that maps dApp-supplied ORIGINATOR_INFO (attacker-controlled)
 * into the desktop main process's strict DAppOriginSchema bounds
 * (name <= 64 chars no control chars, http(s)-or-empty url <= 256 chars,
 * hex/uuid channelId <= 64). A value that would be zod-rejected by main must
 * be repaired here, because a rejected signature request strands the dApp.
 */

import { afterEach, describe, expect, it, jest } from '@jest/globals';
import {
  buildDappOrigin,
  desktopSigner,
  supportsDappGasLimit,
  type QrlWalletBridge,
} from '../bridge';

const CHANNEL = '0199aabb-ccdd-eeff-0011-223344556677';

describe('buildDappOrigin', () => {
  it('passes through clean values with via=dapp', () => {
    const origin = buildDappOrigin('Test dApp', 'https://zondscan.com/dapp-example', CHANNEL);
    expect(origin).toEqual({
      via: 'dapp',
      name: 'Test dApp',
      url: 'https://zondscan.com/dapp-example',
      channelId: CHANNEL,
    });
  });

  describe('channelId gate (returns undefined: request proceeds without provenance)', () => {
    it.each([
      ['empty', ''],
      ['non-hex chars', 'not-a-channel!'],
      ['over 64 chars', 'a'.repeat(65)],
      ['whitespace', '0199 aabb'],
    ])('drops origin for %s channelId', (_label, channelId) => {
      expect(buildDappOrigin('dApp', 'https://a.example', channelId)).toBeUndefined();
    });

    it('accepts plain hex without dashes', () => {
      expect(buildDappOrigin('d', undefined, 'abcdef0123456789')?.channelId).toBe(
        'abcdef0123456789'
      );
    });
  });

  describe('name sanitising', () => {
    it('strips control characters and trims', () => {
      const origin = buildDappOrigin('\u0000\u001f My\u007fdApp \u0001', undefined, CHANNEL);
      expect(origin?.name).toBe('MydApp');
    });

    it('clamps to 64 chars', () => {
      const origin = buildDappOrigin('x'.repeat(65), undefined, CHANNEL);
      expect(origin?.name).toBe('x'.repeat(64));
    });

    it.each([
      ['undefined', undefined],
      ['empty', ''],
      ['all control chars', '\u0000\u0001\u0002'],
      ['whitespace only', '   '],
    ])('falls back to "Unknown dApp" for %s name', (_label, name) => {
      expect(buildDappOrigin(name, undefined, CHANNEL)?.name).toBe('Unknown dApp');
    });
  });

  describe('url sanitising (http(s)-or-empty, validate BEFORE bounding)', () => {
    it.each([
      ['javascript scheme', 'javascript:alert(1)'],
      ['file scheme', 'file:///etc/passwd'],
      ['ftp scheme', 'ftp://a.example'],
      ['unparseable', 'not a url'],
      ['undefined', undefined],
      ['empty', ''],
    ])('maps %s to empty string', (_label, url) => {
      expect(buildDappOrigin('d', url, CHANNEL)?.url).toBe('');
    });

    it('keeps http and https URLs', () => {
      expect(buildDappOrigin('d', 'http://a.example', CHANNEL)?.url).toBe('http://a.example');
      expect(buildDappOrigin('d', 'https://a.example', CHANNEL)?.url).toBe('https://a.example');
    });

    it('keeps a valid URL of exactly 256 chars', () => {
      const url = `https://a.example/${'p'.repeat(256 - 'https://a.example/'.length)}`;
      expect(url).toHaveLength(256);
      expect(buildDappOrigin('d', url, CHANNEL)?.url).toBe(url);
    });

    it('drops (not truncates) a valid URL longer than 256 chars', () => {
      // Regression guard: slicing to 256 before parsing used to turn a
      // long-but-valid URL into a truncated string that either failed to
      // parse or, worse, parsed into a valid-but-wrong URL shown in the
      // trusted confirm. Over-cap URLs can never pass main's schema, so the
      // only honest mapping is '' ("(not provided)").
      const url = `https://a.example/${'p'.repeat(300)}`;
      expect(buildDappOrigin('d', url, CHANNEL)?.url).toBe('');
    });
  });
});

// ---------------------------------------------------------------------------
// dApp gas-limit passthrough + the older-shell capability gate
// ---------------------------------------------------------------------------

interface FakeShell {
  bridge: QrlWalletBridge;
  builds: Record<string, unknown>[];
}

/**
 * A minimal `window.qrlWallet` stand-in. `supportsGas: false` models a desktop
 * shell that predates the optional `gas` field: its real IPC schema is strict,
 * so an unknown key would be rejected at the boundary and the dApp request
 * would be stranded.
 */
function installFakeShell(opts: { supportsGas: boolean }): FakeShell {
  const builds: Record<string, unknown>[] = [];
  // Only the three methods these paths touch are implemented, so the stub is
  // widened from `unknown` once, with no assertion through the full bridge
  // interface.
  const stub: unknown = {
    addressScheme: 'qip55-64',
    ...(opts.supportsGas ? { features: { dappGasLimit: true } } : {}),
    buildTransaction: (args: Record<string, unknown>) => {
      builds.push(args);
      return Promise.resolve({ ...args, nonce: 1, gas: '120000', chainId: 3151909 });
    },
    requestSignature: () =>
      Promise.resolve({
        kind: 'transaction' as const,
        signature: '0xabcd',
        rawTransaction: '0xabcd',
        signer: `Q${'a'.repeat(128)}`,
      }),
    sendRawTransaction: () => Promise.resolve({ transactionHash: `0x${'1'.repeat(64)}` }),
  };
  const bridge = stub as QrlWalletBridge;
  (globalThis as { window?: unknown }).window = { qrlWallet: bridge };
  return { bridge, builds };
}

const TX = {
  from: `Q${'a'.repeat(128)}`,
  to: `Q${'b'.repeat(128)}`,
  value: '0',
  data: '0xad4c2381',
};

describe('desktop dApp gas-limit passthrough', () => {
  afterEach(() => {
    delete (globalThis as { window?: unknown }).window;
    jest.restoreAllMocks();
  });

  it('reports the shell capability from the advertised feature flag', () => {
    installFakeShell({ supportsGas: true });
    expect(supportsDappGasLimit()).toBe(true);
    installFakeShell({ supportsGas: false });
    expect(supportsDappGasLimit()).toBe(false);
  });

  it('forwards the requested gas limit to buildTransaction', async () => {
    const shell = installFakeShell({ supportsGas: true });
    await desktopSigner.signAndSendTransaction({ ...TX, gas: '350000' });
    expect(shell.builds).toHaveLength(1);
    expect(shell.builds[0]).toMatchObject({ gas: '350000', data: '0xad4c2381' });
  });

  it('forwards the requested gas limit on the sign-only path too', async () => {
    const shell = installFakeShell({ supportsGas: true });
    await desktopSigner.signTransactionOnly({ ...TX, gas: '350000' });
    expect(shell.builds[0]).toMatchObject({ gas: '350000' });
  });

  it('omits the key entirely when no gas limit was requested', async () => {
    const shell = installFakeShell({ supportsGas: true });
    await desktopSigner.signAndSendTransaction(TX);
    expect(shell.builds[0]).not.toHaveProperty('gas');
  });

  it('withholds the gas limit from a shell that does not advertise support', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const shell = installFakeShell({ supportsGas: false });
    const result = await desktopSigner.signAndSendTransaction({ ...TX, gas: '350000' });
    // The send still completes on the shell's own estimate: a strict-schema
    // rejection over an unknown key would have stranded the dApp request.
    expect(result.transactionHash).toBe(`0x${'1'.repeat(64)}`);
    expect(shell.builds[0]).not.toHaveProperty('gas');
    expect(warn).toHaveBeenCalled();
  });
});
