import { DAPP_TRANSACTION_LIMITS, RequestHandler } from '../RequestHandler';
import { TYPED_DATA_LIMITS } from '@/utils/signing';
import { isExactQrlAccount, Q_ADDRESS_PATTERN } from '../accountBinding';

const SIGNER = 'Q0000000000000000000000000000000000000000';
const RECIPIENT = 'Q1111111111111111111111111111111111111111';

function typedPayload(fieldType: string, value: unknown): unknown {
  return {
    types: {
      QRLDomain: [{ name: 'name', type: 'string' }],
      Payload: [{ name: 'value', type: fieldType }],
    },
    primaryType: 'Payload',
    domain: { name: 'Direct relay security test' },
    message: { value },
  };
}

describe('RequestHandler closed wallet-side RPC policy', () => {
  it('allows only exact restricted and unrestricted methods', () => {
    expect(RequestHandler.isKnownMethod('qrl_sendTransaction')).toBe(true);
    expect(RequestHandler.isRestricted('qrl_sendTransaction')).toBe(true);
    expect(RequestHandler.isKnownMethod('qrl_getBalance')).toBe(true);
    expect(RequestHandler.isRestricted('qrl_getBalance')).toBe(false);

    expect(RequestHandler.isKnownMethod('qrl_sendRawTransaction')).toBe(false);
    expect(RequestHandler.isKnownMethod('qrl_signFuturePayload')).toBe(false);
    expect(RequestHandler.isKnownMethod('wallet_signFuturePayload')).toBe(false);
    expect(RequestHandler.isKnownMethod('wallet_addQrlChain')).toBe(false);
    expect(RequestHandler.isKnownMethod('qrl_newFilter')).toBe(false);
    expect(RequestHandler.isKnownMethod('personal_sign')).toBe(false);
  });

  it('validates the complete JSON-RPC request envelope', () => {
    expect(
      RequestHandler.validateJsonRpcEnvelope({
        jsonrpc: '2.0',
        id: 'request-1',
        method: 'qrl_accounts',
        params: [],
      }),
    ).toEqual({ id: 'request-1', method: 'qrl_accounts', params: [] });

    for (const request of [
      { jsonrpc: '1.0', id: 1, method: 'qrl_accounts', params: [] },
      { jsonrpc: '2.0', id: Number.NaN, method: 'qrl_accounts', params: [] },
      { jsonrpc: '2.0', id: '', method: 'qrl_accounts', params: [] },
      { jsonrpc: '2.0', id: 'x'.repeat(129), method: 'qrl_accounts', params: [] },
      { jsonrpc: '2.0', id: 1.5, method: 'qrl_accounts', params: [] },
      {
        jsonrpc: '2.0',
        id: Number.MAX_SAFE_INTEGER + 1,
        method: 'qrl_accounts',
        params: [],
      },
      { jsonrpc: '2.0', id: 1, method: '', params: [] },
      { jsonrpc: '2.0', id: 1, method: 'x'.repeat(129), params: [] },
      { jsonrpc: '2.0', id: 1, method: 'qrl_accounts', params: {} },
    ]) {
      expect(() => RequestHandler.validateJsonRpcEnvelope(request)).toThrow();
    }
  });

  it('binds QRL accounts with exact string equality', () => {
    const canonical = 'QABCDEFABCDEFABCDEFABCDEFABCDEFABCDEFABCD';
    const caseVariant = `Q${canonical.slice(1).toLowerCase()}`;

    expect(isExactQrlAccount(canonical, canonical)).toBe(true);
    expect(isExactQrlAccount(caseVariant, canonical)).toBe(false);
    expect(Q_ADDRESS_PATTERN.test(`q${canonical.slice(1)}`)).toBe(false);
  });

  it('accepts only empty qrl_requestAccounts params', () => {
    expect(() =>
      RequestHandler.validateRestrictedRequest('qrl_requestAccounts', []),
    ).not.toThrow();
    expect(() =>
      RequestHandler.validateRestrictedRequest('qrl_requestAccounts', [SIGNER]),
    ).toThrow('does not accept parameters');
  });

  it('validates typed data recursively even when the dApp bypasses the SDK', () => {
    const tooMany = new Array(TYPED_DATA_LIMITS.maxArrayLength + 1).fill(1);
    expect(() =>
      RequestHandler.validateRestrictedRequest('qrl_signTypedData', [
        SIGNER,
        typedPayload('uint8[]', tooMany),
      ]),
    ).toThrow('exceeds length limit');
  });

  it('rejects typed-data fields that would be displayed but not signed', () => {
    const withUnsignedDisplay = {
      ...(typedPayload('uint8', 1) as Record<string, unknown>),
      displayPrompt: 'Harmless login',
    };
    expect(() =>
      RequestHandler.validateRestrictedRequest('qrl_signTypedData', [
        SIGNER,
        withUnsignedDisplay,
      ]),
    ).toThrow(/unknown top-level fields/);
  });

  it('accepts bounded typed data and strict message bytes', () => {
    expect(() =>
      RequestHandler.validateRestrictedRequest('qrl_signTypedData', [
        SIGNER,
        typedPayload('uint16[]', [1, 2]),
      ]),
    ).not.toThrow();
    expect(() =>
      RequestHandler.validateRestrictedRequest('qrl_signMessage', [SIGNER, '0x0102']),
    ).not.toThrow();
  });

  it('rejects oversized opaque signing messages before they reach approval UI', () => {
    const oversized = `0x${'aa'.repeat(TYPED_DATA_LIMITS.maxDynamicBytes + 1)}`;
    expect(() =>
      RequestHandler.validateRestrictedRequest('qrl_signMessage', [SIGNER, oversized]),
    ).toThrow('bounded');
  });

  it('accepts one bounded canonical transaction for approval', () => {
    expect(() =>
      RequestHandler.validateRestrictedRequest('qrl_sendTransaction', [
        {
          from: SIGNER,
          to: RECIPIENT,
          value: '0x0',
          gas: '0x5208',
          data: '0x0102',
        },
      ]),
    ).not.toThrow();
  });

  it.each([
    ['non-array params', { to: RECIPIENT }],
    ['non-object transaction', ['not-an-object']],
    ['invalid from', [{ from: 'Q1234', to: RECIPIENT }]],
    ['missing to', [{ from: SIGNER }]],
    ['invalid to', [{ to: 'Q1234' }]],
    ['object data', [{ to: RECIPIENT, data: { malicious: true } }]],
    ['odd data', [{ to: RECIPIENT, data: '0xabc' }]],
    ['negative gas', [{ to: RECIPIENT, gas: -1 }]],
    ['unsafe gas number', [{ to: RECIPIENT, gas: Number.MAX_SAFE_INTEGER + 1 }]],
    ['unsafe gas quantity', [{ to: RECIPIENT, gas: '0x20000000000000' }]],
    ['non-canonical value', [{ to: RECIPIENT, value: '0x00' }]],
    ['negative value', [{ to: RECIPIENT, value: '-1' }]],
  ])('rejects malformed transaction input: %s', (_name, params) => {
    expect(() =>
      RequestHandler.validateRestrictedRequest('qrl_signTransaction', params),
    ).toThrow();
  });

  it('rejects oversized transaction data before approval rendering', () => {
    const data = `0x${'aa'.repeat(DAPP_TRANSACTION_LIMITS.maxDataBytes + 1)}`;
    expect(() =>
      RequestHandler.validateRestrictedRequest('qrl_sendTransaction', [
        { from: SIGNER, to: RECIPIENT, data },
      ]),
    ).toThrow('bounded');
  });
});
