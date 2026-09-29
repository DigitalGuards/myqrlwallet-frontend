import {
  buildReviewedDAppTransaction,
  desktopGasLimit,
  desktopTransactionArgs,
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
      maxFeePerGasHex: '0x9502f90e',
      maxPriorityFeePerGasHex: '0x9502f900',
    });

    for (const field of ['from', 'to', 'value', 'gas', 'data', 'chainId'] as const) {
      expect(signed[field]).toBe(reviewed[field]);
    }
  });

  it('signs with the quoted fee cap and tip as separate fields', () => {
    const signed = buildReviewedDAppTransaction({ to: `Q${'1'.repeat(128)}` }, {
      gas: 21000,
      nonce: 0,
      maxFeePerGasHex: '0x9502f90e',
      maxPriorityFeePerGasHex: '0x9502f900',
    });

    expect(signed['maxFeePerGas']).toBe('0x9502f90e');
    expect(signed['maxPriorityFeePerGas']).toBe('0x9502f900');
    expect(signed['type']).toBe('0x2');
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

  it('drops a limit that could never build, leaving main to estimate', () => {
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

describe('desktopGasLimit input hygiene', () => {
  it('accepts only the two spellings an RPC transaction object uses', () => {
    expect(desktopGasLimit('0x55730')).toBe('350000');
    expect(desktopGasLimit('350000')).toBe('350000');
    // BigInt() alone would read these; a gas field never carries them.
    expect(desktopGasLimit('0b101')).toBeUndefined();
    expect(desktopGasLimit('0o7')).toBeUndefined();
    expect(desktopGasLimit('0x0abc')).toBeUndefined();
    expect(desktopGasLimit('00350000')).toBeUndefined();
    expect(desktopGasLimit(' 0x10 ')).toBe('16');
  });

  it('drops a non-integral or unsafe number', () => {
    expect(desktopGasLimit(1.9)).toBeUndefined();
    expect(desktopGasLimit(2 ** 53)).toBeUndefined();
    expect(desktopGasLimit(Number.MAX_VALUE)).toBeUndefined();
    expect(desktopGasLimit(Number.MAX_SAFE_INTEGER)).toBe(String(Number.MAX_SAFE_INTEGER));
  });

  it('drops anything past the safe-integer bound the desktop schema allows', () => {
    // A 78-digit limit would be rejected by the desktop's 18-digit cap, which
    // fails the whole build and strands the dApp request.
    expect(desktopGasLimit(`0x${'f'.repeat(64)}`)).toBeUndefined();
    expect(desktopGasLimit('0x20000000000000')).toBeUndefined();
    expect(desktopGasLimit('0x1fffffffffffff')).toBe('9007199254740991');
  });

  it('never emits a value past 18 digits', () => {
    for (const input of ['0x1fffffffffffff', '350000', String(Number.MAX_SAFE_INTEGER)]) {
      expect((desktopGasLimit(input) ?? '').length).toBeLessThanOrEqual(18);
    }
  });
});

describe('desktopTransactionArgs', () => {
  const FROM = `Q${'a'.repeat(128)}`;
  const TO = `Q${'b'.repeat(128)}`;

  it('builds the argument object both desktop signing paths send', () => {
    expect(
      desktopTransactionArgs(
        { from: 'ignored', to: TO, value: '0xde0b6b3a7640000', data: '0xad4c2381', gas: '0x55730' },
        FROM
      )
    ).toEqual({
      from: FROM,
      to: TO,
      value: '1000000000000000000',
      data: '0xad4c2381',
      gas: '350000',
    });
  });

  it('binds from to the caller, ignoring the dApp-supplied from', () => {
    expect(desktopTransactionArgs({ from: TO, to: TO }, FROM).from).toBe(FROM);
  });

  it('defaults a missing value to zero', () => {
    expect(desktopTransactionArgs({ to: TO }, FROM).value).toBe('0');
    expect(desktopTransactionArgs({ to: TO, value: '0x0' }, FROM).value).toBe('0');
  });

  it('omits an optional key it has no value for', () => {
    // The desktop IPC schema is strict and inspects keys, so an explicit
    // undefined would still be an unknown key on an older shell.
    const args = desktopTransactionArgs({ to: TO, value: '0x1' }, FROM);
    expect(Object.keys(args).sort()).toEqual(['from', 'to', 'value']);
  });

  it('omits an empty calldata string', () => {
    expect(desktopTransactionArgs({ to: TO, data: '' }, FROM)).not.toHaveProperty('data');
  });

  it('omits a gas limit that could never build', () => {
    for (const gas of [0, '0x0', '0', -5, 'not-a-number']) {
      expect(desktopTransactionArgs({ to: TO, gas }, FROM)).not.toHaveProperty('gas');
    }
  });
});
