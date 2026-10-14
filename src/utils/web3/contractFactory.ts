/** Construct the method surface inferred from the wallet's ABI literal. */
import type { default as Web3Type, ContractAbi } from "@theqrl/web3";

export function contractMethods<Abi extends ContractAbi>(
  web3: Web3Type,
  abi: Abi,
  address: string,
) {
  const contract = new web3.qrl.Contract(abi, address);
  return contract.methods;
}
