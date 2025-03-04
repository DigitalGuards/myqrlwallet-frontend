export const formatBalance = (
    balance: string | number,
    decimals: number = 2,
    useThousandSeparator: boolean = true
): string => {
    // Convert to number if string
    const num = typeof balance === 'string' ? parseFloat(balance) : balance;

    // Handle invalid input
    if (isNaN(num)) return '0';

    // Format with fixed decimals
    let formatted = num.toFixed(decimals);

    // Add thousand separators if requested
    if (useThousandSeparator) {
        const parts = formatted.split('.');
        parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
        formatted = parts.join('.');
    }

    return formatted;
}; 
