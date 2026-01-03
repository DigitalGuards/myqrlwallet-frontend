/**
 * A utility for handling string related operations
 */
class StringUtil {
  /**
   * A function for splitting the address with spaces between them, making the address more readable.
   */
  static getSplitAddress(accountAddress: string, splitLength: number = 4) {
    // Handle "0x" prefix for hex addresses, or single char prefix (e.g., "Z" for future testnet)
    const prefixLength = accountAddress.startsWith("0x") ? 2 : 1;
    const prefix = accountAddress.substring(0, prefixLength);
    const idSplit: string[] = [];
    for (let i = prefixLength; i < accountAddress.length; i += splitLength) {
      idSplit.push(accountAddress.substring(i, i + splitLength));
    }

    return [prefix, ...idSplit].join(" ");
  }
}

export default StringUtil;
