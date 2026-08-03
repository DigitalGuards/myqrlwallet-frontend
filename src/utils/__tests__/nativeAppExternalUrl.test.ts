export {};

const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');

describe('external URL boundary', () => {
  let open: jest.Mock;
  let postMessage: jest.Mock;

  beforeEach(() => {
    jest.resetModules();
    open = jest.fn();
    postMessage = jest.fn();
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: Object.assign(new EventTarget(), {
        open,
        ReactNativeWebView: { postMessage },
      }),
    });
    Object.defineProperty(globalThis, 'navigator', {
      configurable: true,
      value: { userAgent: 'Browser test' },
    });
  });

  afterAll(() => {
    if (originalWindow) Object.defineProperty(globalThis, 'window', originalWindow);
    else Reflect.deleteProperty(globalThis, 'window');
    if (originalNavigator) Object.defineProperty(globalThis, 'navigator', originalNavigator);
    else Reflect.deleteProperty(globalThis, 'navigator');
  });

  it.each([
    'javascript:alert(1)',
    'intent://wallet/#Intent;scheme=qrl;end',
    'tel:+15551234567',
    'custom-wallet://open',
    'https://user:password@example.com/private',
    'http://example.com/plaintext',
    'http://192.168.1.10/private',
    'http://localhost.evil.example/private',
    'https://[::1',
  ])('rejects unsafe input %s', async (url) => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { openExternalUrl } = await import('../nativeApp');

    openExternalUrl(url);

    expect(open).not.toHaveBeenCalled();
    expect(postMessage).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it('opens valid HTTPS with no opener authority', async () => {
    const { openExternalUrl } = await import('../nativeApp');
    const url = 'https://example.com/explorer/tx/123?network=testnet';

    openExternalUrl(url);

    expect(open).toHaveBeenCalledWith(url, '_blank', 'noopener,noreferrer');
  });

  it.each([
    ['http://localhost:5173', 'http://localhost:5173/'],
    ['http://wallet.localhost:5173/return', 'http://wallet.localhost:5173/return'],
    ['http://127.0.0.1:4173', 'http://127.0.0.1:4173/'],
    ['http://[::1]:4173', 'http://[::1]:4173/'],
  ])('allows and canonicalizes an explicit loopback URL', async (url, canonical) => {
    const { openExternalUrl } = await import('../nativeApp');

    openExternalUrl(url);

    expect(open).toHaveBeenCalledWith(canonical, '_blank', 'noopener,noreferrer');
  });

  it('sends only the parsed HTTPS URL across the native bridge', async () => {
    Object.defineProperty(globalThis, 'navigator', {
      configurable: true,
      value: { userAgent: 'MyQRLWallet test WebView' },
    });
    const { getCurrentNativeDocumentId, openExternalUrl } = await import('../nativeApp');
    const url = 'https://example.com/help';

    openExternalUrl(url);

    expect(postMessage).toHaveBeenCalledWith(
      JSON.stringify({
        type: 'OPEN_URL',
        payload: { url, documentId: getCurrentNativeDocumentId() },
      }),
    );
    expect(open).not.toHaveBeenCalled();
  });
});
