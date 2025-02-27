/**
 * A utility for handling string related operations
 */
class StringUtil {
  /**
   * A function for splitting the address with spaces between them, making the address more readable.
   */
  static getSplitAddress(accountAddress: string, splitLength: number = 4) {
    const prefix = accountAddress.substring(0, 1);
    const idSplit: string[] = [];
    for (let i = 1; i < accountAddress.length; i += splitLength) {
      idSplit.push(accountAddress.substring(i, i + splitLength));
    }

    return [prefix, ...idSplit].join(" ");
  }
}

export default StringUtil;
