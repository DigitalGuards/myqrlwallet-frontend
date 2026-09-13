import {
  findQrlVm64Log,
  requestQrlVm64Logs,
} from '../vm64Logs';
import { qrlVm64EventTopicFromHash } from '../address';

const ADDRESS = `Q${'1'.repeat(128)}`;
const LEGACY_Q40 = `Q${'1'.repeat(40)}`;
const BLOCK_HASH = `0x${'22'.repeat(32)}`;
const TRANSACTION_HASH = `0x${'33'.repeat(32)}`;
const EVENT_TOPIC = qrlVm64EventTopicFromHash(`0x${'44'.repeat(32)}`);

if (!EVENT_TOPIC) throw new Error('test event topic must be valid');

describe('VM64 log RPC boundary', () => {
  it('bypasses the legacy SDK filter validator with one exact 64-byte topic', async () => {
    const send = jest.fn(async () => []);
    const web3 = { requestManager: { send } };

    await expect(
      requestQrlVm64Logs(web3, {
        blockHash: BLOCK_HASH,
        address: ADDRESS,
        topic: EVENT_TOPIC.toUpperCase().replace('0X', '0x'),
      }),
    ).resolves.toEqual([]);
    expect(send).toHaveBeenCalledWith({
      method: 'qrl_getLogs',
      params: [
        {
          blockHash: BLOCK_HASH,
          address: ADDRESS,
          topics: [EVENT_TOPIC],
        },
      ],
    });
  });

  it('fails closed before RPC on 32-byte topics, Q+40, and malformed block hashes', async () => {
    const send = jest.fn(async () => []);
    const web3 = { requestManager: { send } };

    await expect(
      requestQrlVm64Logs(web3, {
        blockHash: BLOCK_HASH,
        address: ADDRESS,
        topic: `0x${'44'.repeat(32)}`,
      }),
    ).rejects.toThrow('exact 64-byte topic');
    await expect(
      requestQrlVm64Logs(web3, {
        blockHash: BLOCK_HASH,
        address: LEGACY_Q40,
        topic: EVENT_TOPIC,
      }),
    ).rejects.toThrow('QIP-55');
    await expect(
      requestQrlVm64Logs(web3, {
        blockHash: '0x22',
        address: ADDRESS,
        topic: EVENT_TOPIC,
      }),
    ).rejects.toThrow('32-byte block hash');
    expect(send).not.toHaveBeenCalled();
  });

  it('selects only the exact transaction, contract, and padded signature', () => {
    const addressTopic = `0x${'55'.repeat(64)}`;
    const exact = {
      transactionHash: TRANSACTION_HASH,
      address: ADDRESS,
      topics: [EVENT_TOPIC, addressTopic],
    };
    const logs = [
      { ...exact, transactionHash: `0x${'66'.repeat(32)}` },
      { ...exact, address: `Q${'2'.repeat(128)}` },
      { ...exact, topics: [`0x${'44'.repeat(32)}`, addressTopic] },
      exact,
    ];

    expect(
      findQrlVm64Log(logs, {
        transactionHash: TRANSACTION_HASH,
        address: ADDRESS,
        topic: EVENT_TOPIC,
      }),
    ).toBe(exact);
  });
});
