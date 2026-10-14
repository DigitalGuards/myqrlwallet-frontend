import Web3 from "@theqrl/web3";
import { erc165ABI } from "@/abi/ERC165ABI";
import { erc721ABI } from "@/abi/ERC721ABI";
import { erc1155ABI } from "@/abi/ERC1155ABI";
import { contractMethods } from "../contractFactory";

const FROM = `Q${"1".repeat(128)}`;
const TO = `Q${"2".repeat(128)}`;
const CONTRACT = `Q${"3".repeat(128)}`;
const word = (hex: string) => hex.padStart(128, "0");

describe("ABI-inferred contract methods", () => {
  const request = jest.fn(() => Promise.reject(new Error("Unexpected RPC")));
  const web3 = new Web3({ request });

  it("encodes ERC-721 transfers with exact VM64 addresses and token ID", () => {
    const methods = contractMethods(web3, erc721ABI, CONTRACT);
    expect(methods.safeTransferFrom(FROM, TO, "0x2a").encodeABI()).toBe(
      `0x42842e0e${FROM.slice(1)}${TO.slice(1)}${word("2a")}`,
    );
    expect(request).not.toHaveBeenCalled();
  });

  it("encodes ERC-1155 transfers with the same amount and bytes offset", () => {
    const methods = contractMethods(web3, erc1155ABI, CONTRACT);
    expect(
      methods.safeTransferFrom(FROM, TO, "42", "7", "0x").encodeABI(),
    ).toBe(
      `0xf242432a${FROM.slice(1)}${TO.slice(1)}${word("2a")}${word("7")}${word("140")}${word("0")}`,
    );
    expect(request).not.toHaveBeenCalled();
  });

  it("retains the ERC-165 method and its interface argument", () => {
    const methods = contractMethods(web3, erc165ABI, CONTRACT);
    expect(methods.supportsInterface("0x80ac58cd").encodeABI()).toBe(
      `0x01ffc9a780ac58cd${"0".repeat(120)}`,
    );
  });

  it.each([undefined, null, "", {}, []].map((address) => ({ address })))(
    "preserves calldata for the library's unbound address form $address",
    ({ address }) => {
      const methods = contractMethods(web3, erc721ABI, address);
      expect(methods.safeTransferFrom(FROM, TO, "0x2a").encodeABI()).toBe(
        `0x42842e0e${FROM.slice(1)}${TO.slice(1)}${word("2a")}`,
      );
      expect(request).not.toHaveBeenCalled();
    },
  );
});
