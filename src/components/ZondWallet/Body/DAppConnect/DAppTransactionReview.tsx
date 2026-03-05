/**
 * Transaction Review - Displays transaction details for dApp approval.
 */

import { utils } from '@theqrl/web3';

interface TransactionReviewProps {
  params: Record<string, unknown>;
}

const DAppTransactionReview: React.FC<TransactionReviewProps> = ({ params }) => {
  const to = (params.to as string) || 'Unknown';
  const value = params.value as string | undefined;
  const data = params.data as string | undefined;
  const gas = params.gas as string | undefined;

  const displayValue = value
    ? `${utils.fromWei(BigInt(value).toString(), 'ether')} QRL`
    : '0 QRL';

  return (
    <div className="space-y-3 rounded-md border border-border bg-muted/30 p-4 text-sm">
      <div className="flex justify-between">
        <span className="text-muted-foreground">To</span>
        <span className="font-mono text-xs break-all max-w-[200px] text-right">{to}</span>
      </div>
      <div className="flex justify-between">
        <span className="text-muted-foreground">Value</span>
        <span className="font-semibold">{displayValue}</span>
      </div>
      {gas && (
        <div className="flex justify-between">
          <span className="text-muted-foreground">Gas Limit</span>
          <span>{parseInt(gas, 16) || gas}</span>
        </div>
      )}
      {data && data !== '0x' && (
        <div>
          <span className="text-muted-foreground">Data</span>
          <div className="mt-1 max-h-20 overflow-auto rounded bg-muted p-2 font-mono text-xs break-all">
            {data}
          </div>
        </div>
      )}
    </div>
  );
};

export default DAppTransactionReview;
