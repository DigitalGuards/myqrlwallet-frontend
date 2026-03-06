/**
 * DApp Approval Modal - Full approval/rejection UI rendered in WebView.
 * Single source of truth for all dApp request approvals.
 */

import { useState, useCallback } from 'react';
import { observer } from 'mobx-react-lite';
import { useStore } from '@/stores/store';
import {
  Dialog,
  DialogContent,
} from '@/components/UI/Dialog';
import { Button } from '@/components/UI/Button';
import DAppTransactionReview from './DAppTransactionReview';
import { utils } from '@theqrl/web3';
import { WalletEncryptionUtil } from '@/utils/crypto/walletEncryption';
import { getNativeInjectedPin } from '@/utils/nativeApp';
import StorageUtil from '@/utils/storage/storage';
import { getExplorerTxUrl } from '@/config';
import { formatAddressShort } from '@/utils/formatting';
import { Loader, Check, X, ExternalLink, Shield, Globe } from 'lucide-react';
import type { TxProgressState } from '@/stores/dappConnectStore';

const METHOD_LABELS: Record<string, string> = {
  zond_requestAccounts: 'Connect Account',
  zond_sendTransaction: 'Send Transaction',
  zond_signTransaction: 'Sign Transaction',
  zond_sign: 'Sign Message',
  personal_sign: 'Sign Message',
  zond_signTypedData: 'Sign Typed Data',
  zond_signTypedData_v3: 'Sign Typed Data',
  zond_signTypedData_v4: 'Sign Typed Data',
  wallet_addZondChain: 'Add Network',
  wallet_switchZondChain: 'Switch Network',
};

const GAS_ESTIMATE_BUFFER_MULTIPLIER = 1.2;

function parseRpcNumber(value: unknown, fallback: number): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'bigint') return Number(value);
  if (typeof value === 'string') {
    const parsed = Number.parseInt(value, value.startsWith('0x') ? 16 : 10);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

function getMessageToSign(
  method: string,
  params: unknown[] | undefined,
  activeAddress: string
): string {
  const first = typeof params?.[0] === 'string' ? params[0] : '';
  const second = typeof params?.[1] === 'string' ? params[1] : '';
  const active = activeAddress.toLowerCase();

  if (method === 'personal_sign') {
    // EIP-191: personal_sign(data, address)
    if (second.toLowerCase() === active) return first;
    return '';
  }

  if (method === 'zond_sign') {
    // eth_sign/zond_sign: (address, data)
    if (first.toLowerCase() === active && second) return second;
    return '';
  }

  return '';
}

function toUserFacingError(error: string): string {
  const msg = error.toLowerCase();
  if (msg.includes('insufficient funds')) {
    return 'Insufficient funds for this transaction.';
  }
  if (msg.includes('nonce too low')) {
    return 'Transaction nonce is too low. Please retry.';
  }
  if (msg.includes('already known')) {
    return 'This transaction was already submitted.';
  }
  if (msg.includes('user denied') || msg.includes('rejected')) {
    return 'Request was rejected.';
  }
  return 'Transaction failed. Please verify details and try again.';
}

function getBorderColor(progress: TxProgressState): string {
  switch (progress) {
    case 'confirming': return 'border-l-orange-500';
    case 'confirmed': return 'border-l-green-500';
    case 'failed': return 'border-l-destructive';
    default: return 'border-l-secondary';
  }
}

const DAppApprovalModal = observer(() => {
  const { dappConnectStore, zondStore } = useStore();
  const { currentApproval, approvalModalOpen, txProgress, txHash, txError } = dappConnectStore;
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const blockchain = zondStore.zondConnection.blockchain;

  const handleApprove = useCallback(async () => {
    if (!currentApproval) return;

    setError('');
    setLoading(true);

    try {
      const { method, params } = currentApproval;

      if (method === 'zond_requestAccounts') {
        const activeAddress = zondStore.activeAccount?.accountAddress;
        dappConnectStore.approveCurrentRequest(activeAddress ? [activeAddress] : []);
        setPin('');
        return;
      }

      if (method === 'wallet_addZondChain' || method === 'wallet_switchZondChain') {
        dappConnectStore.approveCurrentRequest(null);
        setPin('');
        return;
      }

      if (method === 'zond_sendTransaction' || method === 'zond_signTransaction') {
        const pinToUse = getNativeInjectedPin() || pin;
        if (!pinToUse) {
          setError('Please enter your PIN');
          setLoading(false);
          return;
        }

        const activeAddress = zondStore.activeAccount?.accountAddress;
        if (!activeAddress) {
          setError('No active account');
          setLoading(false);
          return;
        }

        // Stage: signing
        dappConnectStore.setTxProgress('signing');

        const blockchainVal = await StorageUtil.getBlockChain();
        const encryptedSeed = await StorageUtil.getEncryptedSeed(blockchainVal, activeAddress);
        if (!encryptedSeed) {
          setError('No encrypted seed found');
          dappConnectStore.setTxProgress('failed', undefined, 'No encrypted seed found');
          setLoading(false);
          return;
        }

        let hexSeed: string;
        try {
          const decrypted = WalletEncryptionUtil.decryptSeedWithPin(encryptedSeed, pinToUse);
          hexSeed = decrypted.hexSeed;
        } catch {
          setPin('');
          setError('Incorrect PIN');
          dappConnectStore.resetTxProgress();
          setLoading(false);
          return;
        }

        const txParams = (params?.[0] || {}) as Record<string, unknown>;
        const web3 = zondStore.zondInstance;
        if (!web3) {
          setError('Web3 not initialized');
          dappConnectStore.setTxProgress('failed', undefined, 'Web3 not initialized');
          setLoading(false);
          return;
        }

        const nonce = await web3.getTransactionCount(activeAddress, 'pending');
        const gasPrice = await web3.getGasPrice();
        const gasPriceHex = utils.toHex(gasPrice);
        const txData = (txParams.data as string) || '0x';
        const txValue = txParams.value ? BigInt(txParams.value as string).toString() : '0';

        let gas: number;
        if (txParams.gas) {
          gas = parseRpcNumber(txParams.gas, 21000);
        } else if (txData && txData !== '0x') {
          const estimated = await web3.estimateGas({
            from: activeAddress,
            to: txParams.to as string,
            value: txValue,
            data: txData,
          });
          gas = Math.ceil(Number(estimated) * GAS_ESTIMATE_BUFFER_MULTIPLIER);
        } else {
          gas = 21000;
        }

        const txObject = {
          from: activeAddress,
          to: txParams.to as string,
          value: txValue,
          gas,
          maxFeePerGas: gasPriceHex,
          maxPriorityFeePerGas: gasPriceHex,
          nonce: Number(nonce),
          data: txData,
          type: '0x2',
        };

        // Stage: broadcasting
        dappConnectStore.setTxProgress('broadcasting');

        const signedTx = await web3.accounts.signTransaction(txObject, hexSeed);

        if (!signedTx.rawTransaction) {
          dappConnectStore.setTxProgress('failed', undefined, 'Failed to sign transaction');
          setLoading(false);
          return;
        }

        if (method === 'zond_signTransaction') {
          dappConnectStore.approveCurrentRequest(signedTx.rawTransaction);
          setPin('');
          setLoading(false);
          return;
        }

        // Use PromiEvent to get real broadcasting → confirming transition
        const promiEvent = web3.sendSignedTransaction(signedTx.rawTransaction);

        await new Promise<void>((resolve) => {
          promiEvent
            .on('transactionHash', (hash: string) => {
              // Tx has been broadcast and accepted by the node
              dappConnectStore.setTxProgress('confirming', hash);
            })
            .on('receipt', (receipt) => {
              const hash = typeof receipt.transactionHash === 'string'
                ? receipt.transactionHash
                : String(receipt.transactionHash);
              dappConnectStore.setTxProgress('confirmed', hash);
              // Send result to dApp but keep modal open to show confirmed state
              dappConnectStore.sendApprovalResult(hash);
              setPin('');
              setLoading(false);
              resolve();
            })
            .on('error', (txErr: Error) => {
              const txErrMsg = txErr.message || String(txErr);
              const userError = toUserFacingError(txErrMsg);
              dappConnectStore.setTxProgress('failed', undefined, userError);
              // Send rejection to dApp but keep modal open to show failed state
              dappConnectStore.sendRejectionResult(`Transaction failed: ${userError}`);
              setPin('');
              setLoading(false);
              resolve();
            });
        });
        return;
      }

      if (method.startsWith('zond_signTypedData')) {
        dappConnectStore.rejectCurrentRequest('Typed data signing is not supported yet');
        return;
      }

      if (method === 'personal_sign' || method === 'zond_sign') {
        const pinToUse = getNativeInjectedPin() || pin;
        if (!pinToUse) {
          setError('Please enter your PIN');
          setLoading(false);
          return;
        }

        const activeAddress = zondStore.activeAccount?.accountAddress;
        if (!activeAddress) {
          setError('No active account');
          setLoading(false);
          return;
        }

        const blockchainVal = await StorageUtil.getBlockChain();
        const encryptedSeed = await StorageUtil.getEncryptedSeed(blockchainVal, activeAddress);
        if (!encryptedSeed) {
          setError('No encrypted seed found');
          setLoading(false);
          return;
        }

        let hexSeed: string;
        try {
          const decrypted = WalletEncryptionUtil.decryptSeedWithPin(encryptedSeed, pinToUse);
          hexSeed = decrypted.hexSeed;
        } catch {
          setPin('');
          setError('Incorrect PIN');
          setLoading(false);
          return;
        }

        const web3 = zondStore.zondInstance;
        if (!web3) {
          setError('Web3 not initialized');
          setLoading(false);
          return;
        }

        const message = getMessageToSign(method, params, activeAddress);
        if (!message) {
          setError('Missing message to sign');
          setLoading(false);
          return;
        }
        const signed = web3.accounts.sign(message, hexSeed);
        dappConnectStore.approveCurrentRequest(signed.signature);
        setPin('');
        return;
      }

      // Default: approve with null
      dappConnectStore.approveCurrentRequest(null);
      setPin('');
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      const userError = toUserFacingError(errMsg);
      setError(userError);
      if (currentApproval) {
        const isTxMethod = currentApproval.method === 'zond_sendTransaction' ||
          currentApproval.method === 'zond_signTransaction';
        if (isTxMethod && dappConnectStore.txProgress !== 'idle') {
          // Keep modal open to show failed state
          dappConnectStore.setTxProgress('failed', undefined, userError);
          dappConnectStore.sendRejectionResult(userError);
        } else {
          dappConnectStore.rejectCurrentRequest(userError);
        }
      }
    } finally {
      setLoading(false);
    }
  }, [currentApproval, pin, dappConnectStore, zondStore]);

  const handleReject = useCallback(() => {
    dappConnectStore.rejectCurrentRequest();
    setPin('');
    setError('');
  }, [dappConnectStore]);

  const handleDone = useCallback(() => {
    dappConnectStore.dismissCurrentApproval();
    setPin('');
    setError('');
  }, [dappConnectStore]);

  if (!currentApproval) return null;

  const { method, params, dappInfo } = currentApproval;
  const label = METHOD_LABELS[method] || method;
  const needsPin = method !== 'zond_requestAccounts' &&
    method !== 'wallet_addZondChain' &&
    method !== 'wallet_switchZondChain';
  const hasNativePin = !!getNativeInjectedPin();
  const isTransaction = method === 'zond_sendTransaction' || method === 'zond_signTransaction';
  const messagePreview = (method === 'personal_sign' || method === 'zond_sign')
    ? getMessageToSign(method, params, zondStore.activeAccount?.accountAddress || '')
    : '';

  const isTxInProgress = txProgress !== 'idle';
  const isTxTerminal = txProgress === 'confirmed' || txProgress === 'failed';

  // Transaction details for display during progress
  const txParams = isTransaction ? (params?.[0] as Record<string, unknown> | undefined) : undefined;
  const txDisplayValue = txParams?.value
    ? `${utils.fromWei(BigInt(txParams.value as string).toString(), 'ether')} QRL`
    : '0 QRL';

  return (
    <Dialog open={approvalModalOpen} onOpenChange={(open) => {
      if (!open && !isTxInProgress) handleReject();
      if (!open && isTxTerminal) handleDone();
    }}>
      <DialogContent className="max-w-md p-0 gap-0 overflow-hidden">
        {/* dApp Identity Header */}
        <div className="bg-gradient-to-r from-secondary/5 to-transparent p-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-secondary/10">
              <Globe className="h-5 w-5 text-secondary" />
            </div>
            <div className="min-w-0 flex-1">
              <h3 className="font-semibold text-foreground truncate">{dappInfo.name}</h3>
              <p className="text-xs text-muted-foreground truncate">{dappInfo.url}</p>
            </div>
            <div className="flex items-center gap-1 rounded-full bg-secondary/10 px-2 py-1">
              <Shield className="h-3 w-3 text-secondary" />
              <span className="text-xs text-secondary font-medium">{label}</span>
            </div>
          </div>
        </div>

        {/* Content area with state-based accent border */}
        <div className={`border-l-4 ${getBorderColor(txProgress)} mx-4 my-3 pl-4 space-y-4`}>
          {/* Transaction progress states */}
          {isTxInProgress ? (
            <div className="space-y-4">
              {/* Progress status row */}
              <div className="flex items-center gap-3 py-2">
                {txProgress === 'signing' && (
                  <>
                    <Loader className="h-5 w-5 animate-spin text-secondary" />
                    <span className="text-sm font-medium">Signing transaction...</span>
                  </>
                )}
                {txProgress === 'broadcasting' && (
                  <>
                    <Loader className="h-5 w-5 animate-spin text-secondary" />
                    <span className="text-sm font-medium">Broadcasting to network...</span>
                  </>
                )}
                {txProgress === 'confirming' && (
                  <>
                    <Loader className="h-5 w-5 animate-spin text-orange-500" />
                    <span className="text-sm font-medium">Awaiting confirmation...</span>
                  </>
                )}
                {txProgress === 'confirmed' && (
                  <>
                    <Check className="h-5 w-5 text-green-500" />
                    <span className="text-sm font-medium text-green-500">Transaction Confirmed</span>
                  </>
                )}
                {txProgress === 'failed' && (
                  <>
                    <X className="h-5 w-5 text-destructive" />
                    <span className="text-sm font-medium text-destructive">Transaction Failed</span>
                  </>
                )}
              </div>

              {/* Tx hash link */}
              {txHash && (
                <a
                  href={getExplorerTxUrl(txHash, blockchain)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-2 text-sm text-secondary hover:text-secondary/80"
                >
                  View on ZondScan <ExternalLink className="h-4 w-4" />
                </a>
              )}

              {/* Transaction details during progress */}
              {txParams && (
                <div className="rounded border bg-muted p-4 text-sm space-y-2">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">To</span>
                    <span className="font-mono text-xs">{formatAddressShort(txParams.to as string || '')}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Value</span>
                    <span className="font-semibold">{txDisplayValue}</span>
                  </div>
                </div>
              )}

              {/* Error message for failed state */}
              {txProgress === 'failed' && txError && (
                <p className="text-sm text-destructive break-all">{txError}</p>
              )}
            </div>
          ) : (
            /* Normal approval content (before tx progress starts) */
            <div className="space-y-4">
              {method === 'zond_requestAccounts' && (
                <p className="text-sm text-muted-foreground">
                  This dApp wants to view your account address.
                </p>
              )}

              {isTransaction && params?.[0] != null && (
                <DAppTransactionReview params={params[0] as Record<string, unknown>} />
              )}

              {(method === 'personal_sign' || method === 'zond_sign') && messagePreview && (
                <div className="rounded-md border border-border bg-muted/30 p-4">
                  <p className="mb-2 text-xs text-muted-foreground">Message to sign:</p>
                  <p className="max-h-32 overflow-auto break-all font-mono text-sm">
                    {messagePreview}
                  </p>
                </div>
              )}

              {needsPin && !hasNativePin && (
                <div>
                  <label className="mb-1 block text-sm font-medium">Enter PIN to sign</label>
                  <input
                    type="password"
                    inputMode="numeric"
                    value={pin}
                    onChange={(e) => {
                      setPin(e.target.value);
                      setError('');
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && pin) handleApprove();
                    }}
                    placeholder="Enter PIN"
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                    autoFocus
                  />
                </div>
              )}

              {error && (
                <p className="text-sm text-destructive">{error}</p>
              )}
            </div>
          )}
        </div>

        {/* Footer buttons */}
        <div className="border-t border-border px-4 py-4">
          {isTxTerminal ? (
            <Button onClick={handleDone} className="w-full">
              {txProgress === 'confirmed' ? 'Done' : 'Close'}
            </Button>
          ) : isTxInProgress ? (
            <p className="text-center text-xs text-muted-foreground">
              Please wait while the transaction is being processed...
            </p>
          ) : (
            <div className="grid grid-cols-2 gap-4">
              <Button variant="outline" onClick={handleReject} disabled={loading}>
                Reject
              </Button>
              <Button onClick={handleApprove} disabled={loading}>
                {loading ? 'Processing...' : 'Approve'}
              </Button>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
});

export default DAppApprovalModal;
