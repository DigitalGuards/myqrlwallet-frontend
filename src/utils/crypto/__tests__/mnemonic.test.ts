/**
 * Round-trip + strictness coverage for src/utils/crypto/mnemonic.ts under the
 * upgraded post-quantum stack (@theqrl/wallet.js 6.x + @theqrl/web3 1.x).
 *
 * Why this exists: mnemonic.ts had ZERO direct unit coverage and was the one
 * load-bearing path the @theqrl upgrade validation could only type-check, not
 * runtime-verify. wallet.js 6 made the `ExtendedSeed` constructor strict (it
 * now hard-throws on any seed that is not exactly 51 bytes with a valid
 * ML-DSA-87 descriptor byte), so these tests pin both the happy-path round-trip
 * and that strictness as a regression guard. Address derivation is pinned to
 * the complete wallet.js QIP-55 identity.
 *
 * cryptoWorkerClient is mocked: it touches `navigator` and a Vite `?worker`
 * import at module load, neither of which exists in jest's node env. The
 * functions under test are synchronous and never call into the worker.
 */

jest.mock('../cryptoWorkerClient', () => ({
  deriveHexSeedAsync: jest.fn(),
  CryptoErrorCode: {},
  CryptoOperationError: class extends Error {},
}));

import {
  MLDSA87,
  newWalletFromExtendedSeed,
  toChecksumAddress,
} from '@theqrl/wallet.js';
import Web3 from '@theqrl/web3';
import { deriveHexSeedAsync } from '../cryptoWorkerClient';
import {
  getMnemonicFromHexSeed,
  getHexSeedFromMnemonic,
  getAddressFromMnemonic,
  getAddressFromMnemonicAsync,
} from '../mnemonic';

const mockDeriveHexSeedAsync = deriveHexSeedAsync as jest.MockedFunction<
  typeof deriveHexSeedAsync
>;

// A pinned, well-formed 51-byte ML-DSA-87 extended seed (descriptor 0x01),
// taken from the cross-repo signing parity fixture (canonical.json). Used to
// confirm the strict ExtendedSeed ctor accepts a known-good seed.
const PINNED_HEX_SEED =
  '0x0100000580a227e1b6d5a89df7723a71e9c03535e9447ec6d160b68c0ba845c68a05c59226cce711eb3db312c022ccf9577be7';

describe('mnemonic.ts under wallet.js 6 + web3 1.0', () => {
  it('round-trips a freshly generated wallet: mnemonic <-> hexSeed', () => {
    const wallet = MLDSA87.newWallet();
    try {
      const hexSeed = wallet.getHexExtendedSeed();
      const mnemonic = wallet.getMnemonic();
      // mnemonic -> hexSeed
      expect(getHexSeedFromMnemonic(mnemonic)).toBe(hexSeed);
      // hexSeed -> mnemonic (exercises the strict ExtendedSeed ctor on a good seed)
      expect(getMnemonicFromHexSeed(hexSeed)).toBe(mnemonic);
    } finally {
      // Always wipe key material from memory, even if an assertion throws.
      wallet.zeroize();
    }
  });

  it('accepts the pinned canonical seed and round-trips it deterministically', () => {
    const mnemonic = getMnemonicFromHexSeed(PINNED_HEX_SEED);
    // The seed is fixed, so derivation must be deterministic and non-empty (a
    // truncated/partial derivation would change this) and must round-trip back
    // to the exact same seed.
    expect(mnemonic).toBeTruthy();
    expect(getMnemonicFromHexSeed(PINNED_HEX_SEED)).toBe(mnemonic);
    expect(getHexSeedFromMnemonic(mnemonic)).toBe(PINNED_HEX_SEED);
  });

  it('derives the complete canonical checksummed QIP-55 address', () => {
    const wallet = MLDSA87.newWallet();
    let mnemonic: string;
    let expectedAddress: string;
    try {
      mnemonic = wallet.getMnemonic();
      expectedAddress = toChecksumAddress(wallet.getAddressStr());
    } finally {
      wallet.zeroize();
    }

    const web3 = new Web3('http://localhost:8545');
    const derivedAddress = getAddressFromMnemonic(mnemonic, web3.qrl);

    expect(derivedAddress).toBe(expectedAddress);
    expect(derivedAddress).toMatch(/^Q[0-9a-fA-F]{128}$/);
  });

  it('preserves the complete identity through worker-backed mnemonic derivation', async () => {
    const wallet = newWalletFromExtendedSeed(PINNED_HEX_SEED);
    let expectedAddress: string;
    try {
      expectedAddress = toChecksumAddress(wallet.getAddressStr());
    } finally {
      wallet.zeroize();
    }
    mockDeriveHexSeedAsync.mockResolvedValueOnce(PINNED_HEX_SEED);

    const web3 = new Web3('http://localhost:8545');
    await expect(getAddressFromMnemonicAsync('worker mnemonic', web3.qrl)).resolves.toBe(
      expectedAddress,
    );
  });

  it('wallet.js 6 ExtendedSeed ctor is strict: rejects malformed seeds (regression pin)', () => {
    // 50 bytes: one short of the required 51-byte extended seed.
    expect(() => getMnemonicFromHexSeed('0x' + '00'.repeat(50))).toThrow(/must be 51 bytes/);
    // 51 bytes but descriptor byte 0x00 != ML_DSA_87 (0x01).
    expect(() => getMnemonicFromHexSeed('0x' + '00'.repeat(51))).toThrow(
      /Invalid wallet type in descriptor/,
    );
  });
});
