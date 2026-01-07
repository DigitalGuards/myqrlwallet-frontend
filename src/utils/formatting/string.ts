import { formatAddress } from "./address";

/**
 * A utility for handling string related operations
 */
class StringUtil {
  /**
   * A function for splitting the address/hash with spaces between them, making it more readable.
   * Uses groups of 6 characters with the prefix included in the first group.
   */
  static getSplitAddress(value: string, groupSize: number = 6) {
    return formatAddress(value, groupSize);
  }
}

export default StringUtil;
