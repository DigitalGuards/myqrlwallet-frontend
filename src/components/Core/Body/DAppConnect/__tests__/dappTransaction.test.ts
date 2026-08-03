import {
  buildReviewedDAppTransaction,
  requestedGasLimit,
} from '../dappTransaction';

describe('reviewed dApp transaction fidelity', () => {
  it('preserves an explicitly reviewed numeric zero gas limit', () => {
    expect(requestedGasLimit({ gas: 0 })).toBe(0);
    expect(requestedGasLimit({})).toBeUndefined();
  });

  it('copies every reviewed dApp field into the signing object unchanged', () => {
    const reviewed = {
      from: 'Q0000000000000000000000000000000000000000',
      to: 'Q1111111111111111111111111111111111111111',
      value: '0x0',
      gas: 0,
      data: '0x0102',
    };
    const signed = buildReviewedDAppTransaction(reviewed, {
      gas: requestedGasLimit(reviewed) ?? 21000,
      nonce: 7,
      gasPriceHex: '0x3b9aca00',
    });

    for (const field of ['from', 'to', 'value', 'gas', 'data'] as const) {
      expect(signed[field]).toBe(reviewed[field]);
    }
  });
});
