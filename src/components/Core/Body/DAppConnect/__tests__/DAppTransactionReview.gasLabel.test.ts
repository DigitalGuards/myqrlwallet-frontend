/** @jest-environment jsdom */

/**
 * The review card's gas-limit label depends on which wallet is rendering it.
 *
 * On desktop the shell resolves max(the requested limit, its own buffered
 * estimate), so the number the dApp asked for is a floor and the card says so.
 * On web and mobile the requested limit is signed as given, so the plain label
 * is the honest one.
 *
 * `isDesktop` is a module-load snapshot of `window.qrlWallet`, so each case
 * needs its own module registry. React and the renderer are pulled from that
 * same registry (an outer React copy would see the isolated component's hooks
 * as foreign), and the markup is rendered statically because the assertion is
 * about one label, with no interaction to drive.
 */

const PARAMS = {
  from: `Q${'a'.repeat(128)}`,
  to: `Q${'b'.repeat(128)}`,
  value: '0x0',
  gas: '0x55730', // 350000
};

async function reviewText(asDesktop: boolean): Promise<string> {
  let text = '';
  await jest.isolateModulesAsync(async () => {
    if (asDesktop) {
      (window as { qrlWallet?: unknown }).qrlWallet = { addressScheme: 'qip55-64' };
    } else {
      Reflect.deleteProperty(window as object, 'qrlWallet');
    }
    const { createElement } = await import('react');
    const { renderToStaticMarkup } = await import('react-dom/server');
    const { default: DAppTransactionReview } = await import('../DAppTransactionReview');
    const markup = renderToStaticMarkup(createElement(DAppTransactionReview, { params: PARAMS }));
    text = markup.replace(/<[^>]*>/g, ' ');
  });
  return text;
}

afterEach(() => {
  Reflect.deleteProperty(window as object, 'qrlWallet');
});

describe('dApp transaction review gas label', () => {
  it('calls the gas limit a minimum on desktop', async () => {
    const text = await reviewText(true);
    expect(text).toContain('Gas Limit (minimum)');
    expect(text).toContain('350000');
  });

  it('labels it plainly on web and mobile, where it is signed as given', async () => {
    const text = await reviewText(false);
    expect(text).toContain('Gas Limit');
    expect(text).not.toContain('(minimum)');
    expect(text).toContain('350000');
  });
});
