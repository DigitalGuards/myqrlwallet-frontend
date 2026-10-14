import {
  isValidQrlAddress,
  normalizeQrlAddress,
  normalizeQrlVm64Topic,
} from './address';
import { isArray, isObject, isRecord } from '@/utils/guards';

interface RpcRequestManager {
  send(args: { method: string; params?: unknown[] }): unknown;
}

export interface QrlVm64Log {
  address: string;
  transactionHash: string;
  topics: unknown[];
}

function getRequestManager(web3: unknown): RpcRequestManager | null {
  if (!isObject(web3)) return null;
  const requestManager = web3['requestManager'];
  if (!isObject(requestManager)) return null;
  if (!hasSend(requestManager)) return null;
  return requestManager;
}

function hasSend(value: Record<string, unknown>): value is Record<string, unknown> & RpcRequestManager {
  return typeof value['send'] === 'function';
}

/**
 * Request logs through the request manager so VM64 topics reach go-qrl intact.
 * The current frontier web3 filter validator still accepts only 32-byte
 * topics, which would reject the exact 64-byte topic before the RPC call.
 */
export async function requestQrlVm64Logs(
  web3: unknown,
  filter: { blockHash: string; address: string; topic: string },
): Promise<unknown[]> {
  const requestManager = getRequestManager(web3);
  if (!requestManager) throw new Error('Web3 request manager does not support send()');
  if (!/^0x[0-9a-fA-F]{64}$/.test(filter.blockHash)) {
    throw new Error('VM64 log filter requires a 32-byte block hash');
  }
  const address = normalizeQrlAddress(filter.address);
  if (!address) throw new Error('VM64 log filter requires a QIP-55 address');
  const topic = normalizeQrlVm64Topic(filter.topic);
  if (!topic) throw new Error('VM64 log filter requires an exact 64-byte topic');

  const result = await requestManager.send({
    method: 'qrl_getLogs',
    params: [{ blockHash: filter.blockHash, address, topics: [topic] }],
  });
  if (!isArray(result)) {
    throw new Error('qrl_getLogs returned a malformed result');
  }
  return result;
}

/** Find one exact transaction/address/signature match in untrusted RPC logs. */
export function findQrlVm64Log(
  logs: readonly unknown[],
  expected: { transactionHash: string; address: string; topic: string },
): QrlVm64Log | undefined {
  const topic = normalizeQrlVm64Topic(expected.topic);
  if (!topic || !isValidQrlAddress(expected.address)) return undefined;
  const transactionHash = expected.transactionHash.toLowerCase();
  const address = expected.address.toLowerCase();

  return logs.find((candidate): candidate is QrlVm64Log => {
    if (!isRecord(candidate)) {
      return false;
    }
    const record = candidate;
    const topics = record['topics'];
    return (
      typeof record['transactionHash'] === 'string' &&
      record['transactionHash'].toLowerCase() === transactionHash &&
      typeof record['address'] === 'string' &&
      record['address'].toLowerCase() === address &&
      Array.isArray(topics) &&
      normalizeQrlVm64Topic(topics[0]) === topic
    );
  });
}
