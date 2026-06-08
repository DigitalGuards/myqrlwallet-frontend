/**
 * Typed @theqrl/web3 contract adapter.
 *
 * @theqrl/web3's `Contract` ABI generics do not resolve the dynamically
 * generated `contract.methods.<abiMethod>` surface from a runtime ABI literal
 * (the inferred `methods` type is an opaque record), so every NFT/token call
 * site used to reach for `contract.methods as any`. This module confines that
 * gap to ONE honest, narrowly-typed seam: the ABI literal is asserted to the
 * library's own `ContractAbi` type and `methods` is narrowed from `unknown` to
 * a hand-written interface. No `any`, no double assertions: every consumer
 * stays laundering-free without an ESLint escape hatch.
 *
 * See CLAUDE.md and the workspace memory note `feedback_theqrl_web3_contract_typings`.
 */

import type { default as Web3Type, ContractAbi } from "@theqrl/web3";

/** A web3 method call that resolves to `T` when `.call()` is awaited. */
export interface CallReturning<T> {
  call(): Promise<T>;
}

/** A web3 method call whose calldata is encoded for inclusion in a tx. */
export interface EncodeAble {
  encodeABI(): string;
}

/** ERC-165 introspection. */
export interface Erc165Methods {
  supportsInterface(interfaceId: string): CallReturning<boolean>;
}

/** Subset of ERC-721 the wallet actually invokes. */
export interface Erc721Methods {
  name(): CallReturning<string>;
  symbol(): CallReturning<string>;
  balanceOf(owner: string): CallReturning<bigint | string>;
  tokenOfOwnerByIndex(owner: string, index: bigint): CallReturning<bigint | string>;
  ownerOf(tokenId: string): CallReturning<string>;
  tokenURI(tokenId: string): CallReturning<string>;
  safeTransferFrom(from: string, to: string, tokenId: string): EncodeAble;
}

/** Subset of ERC-1155 the wallet actually invokes. */
export interface Erc1155Methods {
  balanceOf(account: string, id: string): CallReturning<bigint | string>;
  uri(id: string): CallReturning<string>;
  safeTransferFrom(
    from: string,
    to: string,
    id: string,
    amount: string,
    data: string,
  ): EncodeAble;
}

/**
 * Construct a contract from an ABI + address and return its `methods` object
 * narrowed to the caller-supplied typed interface. The ABI cast is the only
 * sanctioned type-laundering in the codebase and is intentionally local to
 * this module.
 */
export function contractMethods<TMethods>(
  web3: Web3Type,
  // ABI JSON literals don't structurally satisfy @theqrl/web3's AbiFragment[]
  // inference, so accept them opaquely and assert to the library's own type.
  abi: unknown,
  address: string,
): TMethods {
  const contract = new web3.qrl.Contract(abi as ContractAbi, address);
  const methods: unknown = contract.methods;
  return methods as TMethods;
}
