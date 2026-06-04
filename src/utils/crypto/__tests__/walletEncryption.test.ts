/**
 * Coverage for the PIN-based seed encryption in walletEncryption.ts, focused on
 * the removal of the legacy pre-v3 PBKDF2 iteration fallback.
 *
 * Context: ce0b802 ("remove legacy PIN encryption versions (v1, v2)") retired
 * legacy support on the basis that "all users have migrated", but it only
 * dropped the explicit pin_v2 branch and left a `: 5000` else-fallback in the
 * sync decryptSeedWithPin. That made the sync path inconsistent with
 * cryptoWorker.ts, which already ignores the stored version label and always
 * derives at 600k iterations. This suite pins (a) the real v3 round-trip still
 * works end-to-end and (b) decrypt now derives at 600k for ANY stored version,
 * so a pre-v3 blob can no longer be unlocked (matching the async unlock path).
 *
 * The version-fallback cases spy on PBKDF2 instead of running the real 600k
 * derivation, so they assert the iteration count in milliseconds rather than
 * the ~10s a real pure-JS 600k PBKDF2 costs per call in the node test env.
 *
 * nativeApp is mocked: walletEncryption imports it for download/share helpers
 * (unused by the functions under test) and it touches window/navigator, which
 * are absent in jest's node environment.
 */

jest.mock('@/utils/nativeApp', () => ({
  isInNativeApp: () => false,
  shareContent: jest.fn(),
}));

import CryptoJS from 'crypto-js';
import { WalletEncryptionUtil, PinDecryptionError } from '../walletEncryption';

const MNEMONIC =
  'absorb absurd abuse access accident account accuse achieve acid acoustic acquire across';
const HEX_SEED = '0x' + 'ab'.repeat(48);
const PIN = '123456';

describe('WalletEncryptionUtil PIN seed encryption', () => {
  it('writes pin_v3 and round-trips with the correct PIN (real 600k path)', () => {
    const blob = WalletEncryptionUtil.encryptSeedWithPin(MNEMONIC, HEX_SEED, PIN);
    expect(JSON.parse(blob).version).toBe('pin_v3');

    const out = WalletEncryptionUtil.decryptSeedWithPin(blob, PIN);
    expect(out).toEqual({ mnemonic: MNEMONIC, hexSeed: HEX_SEED });
  });

  describe('decrypt always derives at 600k iterations, regardless of stored version', () => {
    // Regression guard for the removed legacy fallback. Spied so the assertion
    // is on the iteration count, not the (mocked, therefore failing) decrypt
    // result, which keeps it fast.
    let spy: ReturnType<typeof jest.spyOn>;

    beforeEach(() => {
      spy = jest
        .spyOn(CryptoJS, 'PBKDF2')
        .mockReturnValue(CryptoJS.lib.WordArray.random(256 / 8));
    });
    afterEach(() => {
      spy.mockRestore();
    });

    it.each(['pin_v1', 'pin_v2', 'pin_v3', 'unlabeled'])(
      'uses 600000 iterations for a %s blob',
      (label) => {
        const blob = JSON.stringify({
          encryptedData: 'deadbeefdeadbeef',
          salt: 'aa'.repeat(16),
          iv: 'bb'.repeat(16),
          version: label === 'unlabeled' ? undefined : label,
          timestamp: 0,
        });

        // Decrypt throws (the mocked key yields garbage), which is expected;
        // the iteration-count assertion below is the actual regression guard.
        expect(() => WalletEncryptionUtil.decryptSeedWithPin(blob, PIN)).toThrow(
          PinDecryptionError,
        );

        expect(spy).toHaveBeenCalledWith(
          PIN,
          expect.anything(),
          expect.objectContaining({ iterations: 600000 }),
        );
      },
    );
  });
});
