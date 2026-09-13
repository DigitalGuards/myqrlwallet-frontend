import {
  getAddressValidationError,
  isValidQrlAddress,
  normalizeQrlAddress,
  normalizeQrlVm64Topic,
  qrlAddressFromIndexedTopic,
  qrlVm64EventTopicFromHash,
  QRL_ADDRESS_LENGTH,
  QRL_ZERO_ADDRESS,
} from '../address';

const LOWER_ADDRESS =
  'Qd5812f6cf4a0f645aa620cd57319a0ed649dd8f5519a9dde7770ae5b0e49e547985f35eb972a2a07041561aa39c65a3991478f9b1e6749e05277dcf58a9a8b72';
const CHECKSUM_ADDRESS =
  'Qd5812F6Cf4a0f645aa620cd57319a0Ed649dd8f5519A9dde7770ae5b0E49e547985f35eB972A2a07041561aa39c65A3991478f9B1e6749e05277dcf58A9A8B72';
const INVALID_CHECKSUM = `QD${CHECKSUM_ADDRESS.slice(2)}`;
const LEGACY_Q40 = `Q${'12'.repeat(20)}`;

describe('QIP-55 address validation', () => {
  it('accepts uniform input and returns the pinned SHAKE256 checksum vector', () => {
    expect(LOWER_ADDRESS).toHaveLength(QRL_ADDRESS_LENGTH);
    expect(isValidQrlAddress(LOWER_ADDRESS)).toBe(true);
    expect(isValidQrlAddress(CHECKSUM_ADDRESS)).toBe(true);
    expect(normalizeQrlAddress(LOWER_ADDRESS)).toBe(CHECKSUM_ADDRESS);
    expect(normalizeQrlAddress(CHECKSUM_ADDRESS)).toBe(CHECKSUM_ADDRESS);
  });

  it('rejects Q+40, lowercase prefixes, malformed hex, and mixed-case checksum drift', () => {
    expect(isValidQrlAddress(LEGACY_Q40)).toBe(false);
    expect(isValidQrlAddress(`q${LOWER_ADDRESS.slice(1)}`)).toBe(false);
    expect(isValidQrlAddress(`Q${'z'.repeat(128)}`)).toBe(false);
    expect(isValidQrlAddress(INVALID_CHECKSUM)).toBe(false);
    expect(isValidQrlAddress(` ${LOWER_ADDRESS}`)).toBe(false);
    expect(normalizeQrlAddress(INVALID_CHECKSUM)).toBeNull();
    expect(normalizeQrlAddress(` ${LOWER_ADDRESS} `)).toBe(CHECKSUM_ADDRESS);
  });

  it('decodes a full indexed address topic with an exact byte-for-byte round trip', () => {
    const topic = `0x${LOWER_ADDRESS.slice(1)}`;
    const decoded = qrlAddressFromIndexedTopic(topic);
    expect(decoded).toBe(CHECKSUM_ADDRESS);
    expect(decoded?.slice(1).toLowerCase()).toBe(topic.slice(2));
    expect(qrlAddressFromIndexedTopic(`0x${LEGACY_Q40.slice(1)}`)).toBeNull();
    expect(qrlAddressFromIndexedTopic(`${topic}00`)).toBeNull();
  });

  it('accepts a 64-byte indexed topic as bytes without truncation', () => {
    const topicBytes = Uint8Array.from(
      LOWER_ADDRESS.slice(1).match(/.{2}/g)?.map((byte) => parseInt(byte, 16)) ?? [],
    );
    expect(topicBytes).toHaveLength(64);
    expect(qrlAddressFromIndexedTopic(topicBytes)).toBe(CHECKSUM_ADDRESS);
  });

  it('left-aligns a 32-byte event hash in an exact VM64 topic', () => {
    const hash = `0x${'ab'.repeat(32)}`;
    const topic = `0x${'ab'.repeat(32)}${'00'.repeat(32)}`;
    expect(qrlVm64EventTopicFromHash(hash)).toBe(topic);
    expect(normalizeQrlVm64Topic(topic.toUpperCase().replace('0X', '0x'))).toBe(topic);
    expect(normalizeQrlVm64Topic(Uint8Array.from(new Array(64).fill(0xab)))).toBe(
      `0x${'ab'.repeat(64)}`,
    );
    expect(qrlVm64EventTopicFromHash(topic)).toBeNull();
    expect(qrlVm64EventTopicFromHash('0xzz')).toBeNull();
    expect(normalizeQrlVm64Topic(hash)).toBeNull();
  });

  it('defines the zero address at the QIP-55 width', () => {
    expect(QRL_ZERO_ADDRESS).toBe(`Q${'0'.repeat(128)}`);
    expect(isValidQrlAddress(QRL_ZERO_ADDRESS)).toBe(true);
  });

  it('reports the exact QIP-55 length and checksum failure', () => {
    expect(getAddressValidationError(LEGACY_Q40)).toContain('/129 characters');
    expect(getAddressValidationError(INVALID_CHECKSUM)).toContain('checksum');
  });
});
