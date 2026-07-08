import { extractQrlAddressFromQrPayload, isValidQrlAddress } from '../address';

const ADDR = 'Q20b4fb2929cfBe8b002b8A0c572551F755e54aEF';
const ADDR_LOWER = `q${ADDR.slice(1).toLowerCase()}`;

describe('extractQrlAddressFromQrPayload', () => {
  it('accepts a bare address (wallet receive QR)', () => {
    expect(extractQrlAddressFromQrPayload(ADDR)).toBe(ADDR);
    expect(extractQrlAddressFromQrPayload(`  ${ADDR}  `)).toBe(ADDR);
  });

  it('normalizes a bare lowercase-q address to a capital Q', () => {
    const extracted = extractQrlAddressFromQrPayload(ADDR_LOWER);
    expect(extracted).toBe(`Q${ADDR.slice(1).toLowerCase()}`);
    expect(extracted !== null && isValidQrlAddress(extracted)).toBe(true);
  });

  it('extracts the address from a zondscan URL (whole address lowercased)', () => {
    const url = `https://zondscan.com/address/${ADDR.toLowerCase()}`;
    expect(extractQrlAddressFromQrPayload(url)).toBe(`Q${ADDR.slice(1).toLowerCase()}`);
  });

  it('extracts from a URL with a trailing path or query', () => {
    expect(
      extractQrlAddressFromQrPayload(`https://zondscan.com/address/${ADDR}?tab=tokens`)
    ).toBe(ADDR);
    expect(extractQrlAddressFromQrPayload(`https://zondscan.com/address/${ADDR}/tokens`)).toBe(
      ADDR
    );
  });

  it('rejects payloads without a QRL address', () => {
    expect(extractQrlAddressFromQrPayload('')).toBeNull();
    expect(extractQrlAddressFromQrPayload('hello world')).toBeNull();
    expect(extractQrlAddressFromQrPayload('https://zondscan.com/blocks')).toBeNull();
  });

  it('rejects tx-hash URLs (64 hex chars, no Q token)', () => {
    expect(
      extractQrlAddressFromQrPayload(
        'https://zondscan.com/tx/0x2b7a79306678b9a40a26a1871bfb468ac24977d9fc7d725df389df3397919c20'
      )
    ).toBeNull();
  });

  it('deliberately rejects bare 0x addresses (likely another EVM chain)', () => {
    expect(extractQrlAddressFromQrPayload(`0x${ADDR.slice(1)}`)).toBeNull();
  });

  it('does not match a Q token embedded in longer hex', () => {
    expect(extractQrlAddressFromQrPayload(`Q${'ab'.repeat(21)}`)).toBeNull();
  });
});
