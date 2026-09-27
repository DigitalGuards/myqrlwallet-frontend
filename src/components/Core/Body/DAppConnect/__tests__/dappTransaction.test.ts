import {
  buildReviewedDAppTransaction,
  desktopGasLimit,
  requestedGasLimit,
} from '../dappTransaction';

describe('reviewed dApp transaction fidelity', () => {
  it('preserves an explicitly reviewed numeric zero gas limit', () => {
    expect(requestedGasLimit({ gas: 0 })).toBe(0);
    expect(requestedGasLimit({})).toBeUndefined();
  });

  it('copies every reviewed dApp field into the signing object unchanged', () => {
    const reviewed = {
      from: `Q${'0'.repeat(128)}`,
      to: `Q${'1'.repeat(128)}`,
      value: '0x0',
      gas: 0,
      data: '0x0102',
      chainId: '0x301825',
    };
    const signed = buildReviewedDAppTransaction(reviewed, {
      gas: requestedGasLimit(reviewed) ?? 21000,
      nonce: 7,
      gasPriceHex: '0x3b9aca00',
    });

    for (const field of ['from', 'to', 'value', 'gas', 'data', 'chainId'] as const) {
      expect(signed[field]).toBe(reviewed[field]);
    }
  });
});

describe('desktopGasLimit', () => {
  it('converts an RPC quantity to the desktop bridge decimal form', () => {
    expect(desktopGasLimit('0x55730')).toBe('350000');
    expect(desktopGasLimit('0x1')).toBe('1');
  });

  it('accepts a decimal string or a number unchanged in value', () => {
    expect(desktopGasLimit('350000')).toBe('350000');
    expect(desktopGasLimit(350000)).toBe('350000');
  });

  it('drops a limit that could never build, so main estimates instead', () => {
    // The desktop schema rejects '0' outright; forwarding it would strand the
    // dApp request on a boundary rejection.
    expect(desktopGasLimit(0)).toBeUndefined();
    expect(desktopGasLimit('0x0')).toBeUndefined();
    expect(desktopGasLimit('0')).toBeUndefined();
    expect(desktopGasLimit(-1)).toBeUndefined();
    expect(desktopGasLimit(undefined)).toBeUndefined();
  });

  it('drops an unusable value so nothing throws mid-approval', () => {
    expect(desktopGasLimit('not-a-number')).toBeUndefined();
    expect(desktopGasLimit('')).toBeUndefined();
    expect(desktopGasLimit(Number.NaN)).toBeUndefined();
    expect(desktopGasLimit(Number.POSITIVE_INFINITY)).toBeUndefined();
  });

  it('composes with requestedGasLimit over raw dApp transaction params', () => {
    expect(desktopGasLimit(requestedGasLimit({ gas: '0x55730' }))).toBe('350000');
    expect(desktopGasLimit(requestedGasLimit({}))).toBeUndefined();
    // requestedGasLimit preserves an explicit numeric zero; the desktop form drops it.
    expect(desktopGasLimit(requestedGasLimit({ gas: 0 }))).toBeUndefined();
  });
});
