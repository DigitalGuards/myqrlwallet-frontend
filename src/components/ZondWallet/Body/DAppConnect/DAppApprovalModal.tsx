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
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/UI/Dialog';
import { Button } from '@/components/UI/Button';
import DAppTransactionReview from './DAppTransactionReview';
import { WalletEncryptionUtil } from '@/utils/crypto/walletEncryption';
import { getNativeInjectedPin } from '@/utils/nativeApp';
import StorageUtil from '@/utils/storage/storage';

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
    if (second.toLowerCase() === active && first) return first;
    return first || second;
  }

  if (method === 'zond_sign') {
    if (first.toLowerCase() === active && second) return second;
    return second || first;
  }

  return first || second;
}

const DAppApprovalModal = observer(() => {
  const { dappConnectStore, zondStore } = useStore();
  const { currentApproval, approvalModalOpen } = dappConnectStore;
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleApprove = useCallback(async () => {
    if (!currentApproval) return;

    setError('');
    setLoading(true);

    try {
      const { method, params } = currentApproval;

      if (method === 'zond_requestAccounts') {
        // Return the active account
        const activeAddress = zondStore.activeAccount?.accountAddress;
        dappConnectStore.approveCurrentRequest(activeAddress ? [activeAddress] : []);
        setPin('');
        return;
      }

      if (method === 'wallet_addZondChain' || method === 'wallet_switchZondChain') {
        // Accept network changes
        dappConnectStore.approveCurrentRequest(null);
        setPin('');
        return;
      }

      if (method === 'zond_sendTransaction' || method === 'zond_signTransaction') {
        // Need PIN to sign transaction
        const pinToUse = getNativeInjectedPin() || pin;
        if (!pinToUse) {
          setError('Please enter your PIN');
          return;
        }

        const activeAddress = zondStore.activeAccount?.accountAddress;
        if (!activeAddress) {
          setError('No active account');
          return;
        }

        // Decrypt seed
        const blockchain = await StorageUtil.getBlockChain();
        const encryptedSeed = await StorageUtil.getEncryptedSeed(blockchain, activeAddress);
        if (!encryptedSeed) {
          setError('No encrypted seed found');
          return;
        }

        let hexSeed: string;
        try {
          const decrypted = WalletEncryptionUtil.decryptSeedWithPin(encryptedSeed, pinToUse);
          hexSeed = decrypted.hexSeed;
        } catch {
          setError('Incorrect PIN');
          return;
        }

        // Sign and send the transaction
        const txParams = (params?.[0] || {}) as Record<string, unknown>;
        const web3 = zondStore.zondInstance;
        if (!web3) {
          setError('Web3 not initialized');
          return;
        }

        const nonce = await web3.getTransactionCount(activeAddress, 'pending');
        const gasPrice = await web3.getGasPrice();

        const txObject = {
          from: activeAddress,
          to: txParams.to as string,
          value: txParams.value ? BigInt(txParams.value as string).toString() : '0',
          gas: parseRpcNumber(txParams.gas, 21000),
          gasPrice: gasPrice.toString(),
          nonce: Number(nonce),
          data: (txParams.data as string) || '0x',
          type: 2,
        };

        const signedTx = await web3.accounts.signTransaction(txObject, hexSeed);

        if (!signedTx.rawTransaction) {
          setError('Failed to sign transaction');
          return;
        }

        if (method === 'zond_signTransaction') {
          dappConnectStore.approveCurrentRequest(signedTx.rawTransaction);
          setPin('');
          return;
        }

        const receipt = await web3.sendSignedTransaction(signedTx.rawTransaction);
        dappConnectStore.approveCurrentRequest(receipt.transactionHash);
        setPin('');
        return;
      }

      if (method.startsWith('zond_signTypedData')) {
        dappConnectStore.rejectCurrentRequest('Typed data signing is not supported yet');
        return;
      }

      if (method === 'personal_sign' || method === 'zond_sign') {
        // Message signing - need PIN
        const pinToUse = getNativeInjectedPin() || pin;
        if (!pinToUse) {
          setError('Please enter your PIN');
          return;
        }

        const activeAddress = zondStore.activeAccount?.accountAddress;
        if (!activeAddress) {
          setError('No active account');
          return;
        }

        const blockchain = await StorageUtil.getBlockChain();
        const encryptedSeed = await StorageUtil.getEncryptedSeed(blockchain, activeAddress);
        if (!encryptedSeed) {
          setError('No encrypted seed found');
          return;
        }

        let hexSeed: string;
        try {
          const decrypted = WalletEncryptionUtil.decryptSeedWithPin(encryptedSeed, pinToUse);
          hexSeed = decrypted.hexSeed;
        } catch {
          setError('Incorrect PIN');
          return;
        }

        const web3 = zondStore.zondInstance;
        if (!web3) {
          setError('Web3 not initialized');
          return;
        }

        const message = getMessageToSign(method, params, activeAddress);
        if (!message) {
          setError('Missing message to sign');
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
      setError(errMsg);
    } finally {
      setLoading(false);
    }
  }, [currentApproval, pin, dappConnectStore, zondStore]);

  const handleReject = useCallback(() => {
    dappConnectStore.rejectCurrentRequest();
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

  return (
    <Dialog open={approvalModalOpen} onOpenChange={(open) => {
      if (!open) handleReject();
    }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{label}</DialogTitle>
          <DialogDescription>
            <span className="font-semibold text-foreground">{dappInfo.name}</span>
            <br />
            <span className="text-xs text-muted-foreground">{dappInfo.url}</span>
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {method === 'zond_requestAccounts' && (
            <p className="text-sm text-muted-foreground">
              This dApp wants to view your account address.
            </p>
          )}

          {isTransaction && params?.[0] != null && (
            <DAppTransactionReview params={params[0] as Record<string, unknown>} />
          )}

          {(method === 'personal_sign' || method === 'zond_sign') && params?.[0] != null && (
            <div className="rounded-md border border-border bg-muted/30 p-4">
              <p className="mb-2 text-xs text-muted-foreground">Message to sign:</p>
              <p className="max-h-32 overflow-auto break-all font-mono text-sm">
                {String(params[0])}
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

        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={handleReject} disabled={loading}>
            Reject
          </Button>
          <Button onClick={handleApprove} disabled={loading}>
            {loading ? 'Processing...' : 'Approve'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
});

export default DAppApprovalModal;
