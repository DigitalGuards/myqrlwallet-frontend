import { parseDAppInfo } from '../dappMetadata';

function metadata(name: string): Record<string, unknown> {
  return {
    name,
    url: 'https://safe.example/app',
    chainId: '0x539',
  };
}

describe('authenticated dApp metadata visual safety', () => {
  it('accepts an ordinary bounded dApp name', () => {
    expect(parseDAppInfo(metadata('Safe Wallet App')).name).toBe('Safe Wallet App');
  });

  it.each([
    ['bidi override', `Safe\u202eevil.example`],
    ['bidi isolate', `Safe\u2066evil.example`],
    ['zero-width text', `Safe\u200bevil.example`],
    ['embedded C0 control', `Safe\u0000evil.example`],
    ['DEL control', `Safe\u007fevil.example`],
    ['C1 control', `Safe\u0085evil.example`],
    ['line separator', `Safe\u2028evil.example`],
    ['paragraph separator', `Safe\u2029evil.example`],
  ])('rejects %s in the identity header', (_label, name) => {
    expect(() => parseDAppInfo(metadata(name))).toThrow(/dApp name is invalid/);
  });
});
