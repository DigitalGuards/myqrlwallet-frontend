/**
 * Formats a Zond address into groups of 6 characters.
 * The Z prefix is included with the first group.
 * Example: Z2019EA08... -> "Z2019E A08f4e 24201B..."
 */
export const formatAddress = (address: string, groupSize: number = 6): string => {
  if (!address) return "";

  const groups: string[] = [];
  for (let i = 0; i < address.length; i += groupSize) {
    groups.push(address.substring(i, i + groupSize));
  }

  return groups.join(" ");
};

/**
 * Formats a Zond address for display in a shortened form.
 * Shows first and last groups with ellipsis in between.
 * Example: Z2019EA08...4b924A04892 -> "Z2019E ... 04892"
 */
export const formatAddressShort = (address: string, groupSize: number = 6): string => {
  if (!address) return "";
  if (address.length <= groupSize * 2) return formatAddress(address, groupSize);

  const firstGroup = address.substring(0, groupSize);
  const lastGroup = address.substring(address.length - groupSize);

  return `${firstGroup} ... ${lastGroup}`;
};
