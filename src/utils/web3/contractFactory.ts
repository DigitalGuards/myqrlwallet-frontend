/** Construct the method surface inferred from the wallet's ABI literal. */
import type { default as Web3Type, Contract, ContractAbi } from "@theqrl/web3";

export function contractMethods<Abi extends ContractAbi>(
  web3: Web3Type,
  abi: Abi,
  address: unknown,
): Contract<Abi>["methods"] {
  const isContract = (value: unknown): value is Contract<Abi> =>
    value instanceof web3.qrl.Contract;
  const contract: unknown = Reflect.construct(web3.qrl.Contract, [abi, address]);
  if (!isContract(contract)) throw new TypeError("Invalid contract instance");
  return contract.methods;
}
