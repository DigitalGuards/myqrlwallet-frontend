/**
 * DApp Approval Modal - Full approval/rejection UI rendered in WebView.
 * Single source of truth for all dApp request approvals.
 */

import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { toJS } from 'mobx';
import { observer } from 'mobx-react-lite';
import { useStore } from '@/stores/store';
import {
  Dialog,
  DialogContent,
} from '@/components/UI/Dialog';
import { Button } from '@/components/UI/Button';
import DAppTransactionReview from './DAppTransactionReview';
import DAppMessageReview from './DAppMessageReview';
import DAppTypedDataReview from './DAppTypedDataReview';
import { utils } from '@theqrl/web3';
import { WalletEncryptionUtil } from '@/utils/crypto/walletEncryption';
import { getNativeInjectedPin } from '@/utils/nativeApp';
import StorageUtil from '@/utils/storage/storage';
import { getExplorerTxUrl } from '@/config';
import { formatAddressShort, formatQuantaValue } from '@/utils/formatting';
import {
  bytesToHex,
  computeMessageDigest,
  computeTypedDataDigest,
  hexToBytes,
  SCHEME_VERSION_MSG,
  SCHEME_VERSION_TYPED,
  signMessage,
  signTypedData,
  SignMessageParamsSchema,
  SignTypedDataParamsSchema,
} from '@/utils/signing';
import { Loader, Check, X, ExternalLink, Shield, Globe } from 'lucide-react';
import type { TxProgressState } from '@/stores/dappConnectStore';
import type { ZodError } from 'zod';
import { isDesktop, desktopSigner, buildDappOrigin } from '@/desktop/bridge';

function formatZodIssues(error: ZodError): string {
  // path segments can be symbols (e.g. a MobX admin key surfaced by zod's
  // record key check); String() coerces them safely whereas Array.join would
  // throw "Cannot convert a Symbol value to a string" and crash the render.
  return error.issues
    .map((i) => `${i.path.length ? i.path.map(String).join('.') : '(root)'}: ${i.message}`)
    .join('; ') || 'malformed params';
}

const METHOD_LABELS: Record<string, string> = {
  qrl_requestAccounts: 'Connect Account',
  qrl_sendTransaction: 'Send Transaction',
  qrl_signTransaction: 'Sign Transaction',
  qrl_signMessage: 'Sign Message',
  qrl_signTypedData: 'Sign Typed Data',
  wallet_addQrlChain: 'Add Network',
  wallet_switchQrlChain: 'Switch Network',
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

/**
 * Shared PIN-unlock: pulls the encrypted seed for `activeAddress` and
 * decrypts it. Callers handle their own UX side effects (progress states,
 * error display); this helper just produces a hexSeed or a reason string.
 */
async function unlockHexSeed(
  pinToUse: string,
  activeAddress: string,
): Promise<{ hexSeed: string } | { error: string }> {
  if (!pinToUse) return { error: 'Please enter your PIN' };
  const blockchainVal = await StorageUtil.getBlockChain();
  const encryptedSeed = await StorageUtil.getEncryptedSeed(blockchainVal, activeAddress);
  if (!encryptedSeed) return { error: 'No encrypted seed found' };
  try {
    const decrypted = await WalletEncryptionUtil.decryptSeedWithPin(encryptedSeed, pinToUse);
    return { hexSeed: decrypted.hexSeed };
  } catch {
    return { error: 'Incorrect PIN' };
  }
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
  const { dappConnectStore, qrlStore } = useStore();
  const { currentApproval, approvalModalOpen, txProgress, txHash, txError } = dappConnectStore;
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  // When the current approval changes (a queued request gets promoted after
  // the previous one is answered), briefly ignore dismissals: a double-click
  // on the X must not reject a request the user never saw rendered.
  const approvalShownAtRef = useRef(0);
  const approvalKey = currentApproval ? `${currentApproval.sessionId}:${currentApproval.id}` : '';
  useEffect(() => {
    approvalShownAtRef.current = Date.now();
  }, [approvalKey]);

  const blockchain = qrlStore.qrlConnection.blockchain;

  const handleApprove = useCallback(async () => {
    if (!currentApproval) return;

    setError('');
    setLoading(true);

    // Answer THIS request, never "whatever is current when an await resolves":
    // a session disconnect promotes the next queued request while PIN unlock,
    // the desktop trusted confirm, or a broadcast is in flight, and answering
    // the live currentApproval would route this result to that other request.
    const { sessionId: approvalSessionId, id: approvalId } = currentApproval;

    try {
      const { method } = currentApproval;
      // currentApproval is a deep MobX observable, so its nested params objects
      // carry a Symbol(mobx administration) key. zod's z.record key check walks
      // own symbols and rejects that key (and the signing encoders must hash a
      // plain object anyway), so de-proxy to plain JS before validating/signing.
      // toJS is digest-neutral: the encoder reads fields by name in type order.
      const params = toJS(currentApproval.params);

      // Desktop: dApp provenance for the trusted confirm modal (sanitised to
      // the desktop schema; the modal labels it unverified/dApp-supplied).
      const dappOrigin = isDesktop
        ? buildDappOrigin(
            currentApproval.dappInfo.name,
            currentApproval.dappInfo.url,
            currentApproval.sessionId,
          )
        : undefined;

      if (method === 'qrl_requestAccounts') {
        const activeAddress = qrlStore.activeAccount?.accountAddress;
        dappConnectStore.approveRequestById(approvalSessionId, approvalId, activeAddress ? [activeAddress] : []);
        setPin('');
        return;
      }

      if (method === 'wallet_addQrlChain' || method === 'wallet_switchQrlChain') {
        // Desktop is single-network: main builds/signs/broadcasts against its
        // configured RPC + chain id, so honouring a renderer-side switch would
        // silently sign for a different chain than the dApp expects. Reject
        // with 4902 (EIP-3326 unrecognized/unavailable chain) instead of
        // flipping renderer state; 4901 would falsely signal a transient
        // provider disconnect and invite reconnect loops.
        if (isDesktop) {
          dappConnectStore.rejectRequestById(approvalSessionId, approvalId, 
            'The desktop wallet is pinned to its configured chain',
            4902,
          );
          setPin('');
          return;
        }
        dappConnectStore.approveRequestById(approvalSessionId, approvalId, null);
        setPin('');
        return;
      }

      if (method === 'qrl_sendTransaction' || method === 'qrl_signTransaction') {
        const activeAddress = qrlStore.activeAccount?.accountAddress;
        if (!activeAddress) {
          setError('No active account');
          setLoading(false);
          return;
        }

        // Bind the request to the account it names, exactly like the
        // signMessage / signTypedData paths above. The tx `from` is substituted
        // with the LIVE active account at approve-click, and that active account
        // can now flip automatically (e.g. an autolock + unlock of a different
        // wallet while this approval sits open), so without this check the dApp
        // could get a signature/spend from an account it never asked for. A dApp
        // that omits `from` accepts the active account.
        const requestedFrom = ((params?.[0] as Record<string, unknown> | undefined)?.['from'] ??
          '') as string;
        if (requestedFrom && requestedFrom.toLowerCase() !== activeAddress.toLowerCase()) {
          setError('Signer mismatch: request is for a different account');
          setLoading(false);
          return;
        }

        // Desktop: build + confirm + sign in the isolated signer (its own
        // trusted modal), then broadcast for send / return raw for sign. No
        // PIN, no seed in the renderer.
        if (isDesktop) {
          const txParamsD = (params?.[0] || {}) as Record<string, unknown>;
          const toD = txParamsD['to'] as string;
          const dataD = (txParamsD['data'] as string) || undefined;
          const valueD = txParamsD['value']
            ? BigInt(txParamsD['value'] as string).toString()
            : '0';
          try {
            dappConnectStore.setTxProgress('signing');
            if (method === 'qrl_signTransaction') {
              const rawTx = await desktopSigner.signTransactionOnly(
                {
                  from: activeAddress,
                  to: toD,
                  value: valueD,
                  data: dataD,
                },
                dappOrigin,
              );
              dappConnectStore.approveRequestById(approvalSessionId, approvalId, rawTx);
              dappConnectStore.resetTxProgress();
              setLoading(false);
              return;
            }
            dappConnectStore.setTxProgress('broadcasting');
            const { transactionHash } = await desktopSigner.signAndSendTransaction(
              {
                from: activeAddress,
                to: toD,
                value: valueD,
                data: dataD,
              },
              dappOrigin,
            );
            dappConnectStore.setTxProgress('confirmed', transactionHash);
            dappConnectStore.sendApprovalResultById(approvalSessionId, approvalId, transactionHash);
            setLoading(false);
          } catch (e) {
            const errMsg = e instanceof Error ? e.message : String(e);
            console.log('[DAppConnect] desktop tx error:', errMsg);
            const userError = toUserFacingError(errMsg);
            dappConnectStore.setTxProgress('failed', undefined, userError);
            dappConnectStore.sendRejectionResultById(approvalSessionId, approvalId, `Transaction failed: ${userError}`);
            setLoading(false);
          }
          return;
        }

        const pinToUse = getNativeInjectedPin() || pin;
        // Guard empty PIN *before* entering the 'signing' progress state.
        // Once txProgress leaves 'idle' the modal switches to its terminal
        // view (PIN input unmounts, only a Close button remains), so an empty
        // PIN reaching the unlock below would strand the user with no retry
        // and leave the dApp request unanswered.
        if (!pinToUse) {
          setError('Please enter your PIN');
          setLoading(false);
          return;
        }

        // Stage: signing
        dappConnectStore.setTxProgress('signing');

        const unlocked = await unlockHexSeed(pinToUse, activeAddress);
        if ('error' in unlocked) {
          setError(unlocked.error);
          if (unlocked.error === 'Incorrect PIN') {
            // Recoverable: reset to the editable state so the user can retry.
            setPin('');
            dappConnectStore.resetTxProgress();
          } else {
            // Non-recoverable (e.g. no stored seed). Answer the dApp so its
            // request does not hang, then show the terminal failed state.
            dappConnectStore.setTxProgress('failed', undefined, unlocked.error);
            dappConnectStore.sendRejectionResultById(approvalSessionId, approvalId, unlocked.error);
          }
          setLoading(false);
          return;
        }
        const hexSeed = unlocked.hexSeed;

        const txParams = (params?.[0] || {}) as Record<string, unknown>;
        const web3 = qrlStore.qrlInstance;
        if (!web3) {
          setError('Web3 not initialized');
          dappConnectStore.setTxProgress('failed', undefined, 'Web3 not initialized');
          dappConnectStore.sendRejectionResultById(approvalSessionId, approvalId, 'Web3 not initialized');
          setLoading(false);
          return;
        }

        const nonce = await web3.getTransactionCount(activeAddress, 'pending');
        const gasPrice = await web3.getGasPrice();
        const gasPriceHex = utils.toHex(gasPrice);
        const txData = (txParams['data'] as string) || '0x';
        const txValue = txParams['value'] ? BigInt(txParams['value'] as string).toString() : '0';

        let gas: number;
        if (txParams['gas']) {
          gas = parseRpcNumber(txParams['gas'], 21000);
        } else if (txData && txData !== '0x') {
          const estimated = await web3.estimateGas({
            from: activeAddress,
            to: txParams['to'] as string,
            value: txValue,
            data: txData,
          });
          gas = Math.ceil(Number(estimated) * GAS_ESTIMATE_BUFFER_MULTIPLIER);
        } else {
          gas = 21000;
        }

        const txObject = {
          from: activeAddress,
          to: txParams['to'] as string,
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
          dappConnectStore.sendRejectionResultById(approvalSessionId, approvalId, 'Failed to sign transaction');
          setLoading(false);
          return;
        }

        if (method === 'qrl_signTransaction') {
          dappConnectStore.approveRequestById(approvalSessionId, approvalId, signedTx.rawTransaction);
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
              dappConnectStore.sendApprovalResultById(approvalSessionId, approvalId, hash);
              setPin('');
              setLoading(false);
              resolve();
            })
            .on('error', (txErr: Error) => {
              const txErrMsg = txErr.message || String(txErr);
              // Log the raw node/broadcast reason (bridges to Metro as a
              // [WebView] line; console.error does not bridge) since
              // toUserFacingError intentionally hides it from the UI.
              console.log('[DAppConnect] tx broadcast error:', txErrMsg);
              const userError = toUserFacingError(txErrMsg);
              dappConnectStore.setTxProgress('failed', undefined, userError);
              dappConnectStore.sendRejectionResultById(approvalSessionId, approvalId, `Transaction failed: ${userError}`);
              setPin('');
              setLoading(false);
              resolve();
            });
        });
        return;
      }

      if (method === 'qrl_signMessage') {
        const parsed = SignMessageParamsSchema.safeParse(params);
        if (!parsed.success) {
          setError(`Invalid qrl_signMessage params: ${formatZodIssues(parsed.error)}`);
          setLoading(false);
          return;
        }
        const [signerParam, messageHex] = parsed.data;
        const activeAddress = qrlStore.activeAccount?.accountAddress;
        if (!activeAddress) {
          setError('No active account');
          setLoading(false);
          return;
        }
        if (signerParam.toLowerCase() !== activeAddress.toLowerCase()) {
          setError('Signer mismatch: request is for a different account');
          setLoading(false);
          return;
        }
        // Desktop: sign in the isolated signer (its own trusted modal); no PIN,
        // no seed in the renderer. The active address rides along so the
        // signer can reject if its session diverged from renderer state, and
        // the response is reshaped to the same rich object the web path
        // returns (the dApp must not see the bridge-internal `kind`).
        if (isDesktop) {
          try {
            const result = await desktopSigner.signMessage(messageHex, activeAddress, dappOrigin);
            dappConnectStore.approveRequestById(approvalSessionId, approvalId, {
              signature: result.signature,
              publicKey: result.publicKey,
              signer: result.signer,
              digest: result.digest,
              schemeVersion: result.schemeVersion ?? SCHEME_VERSION_MSG,
            });
          } catch (e) {
            const errMsg = e instanceof Error ? e.message : String(e);
            setError(`Message signing failed: ${errMsg}`);
            dappConnectStore.rejectRequestById(approvalSessionId, approvalId, `Message signing failed: ${errMsg}`);
          }
          setLoading(false);
          return;
        }
        const pinToUse = getNativeInjectedPin() || pin;
        const unlocked = await unlockHexSeed(pinToUse, activeAddress);
        if ('error' in unlocked) {
          if (unlocked.error === 'Incorrect PIN') setPin('');
          setError(unlocked.error);
          setLoading(false);
          return;
        }
        try {
          const result = signMessage(messageHex, unlocked.hexSeed);
          dappConnectStore.approveRequestById(approvalSessionId, approvalId, result);
        } catch (e) {
          // Reject the dApp on a signing failure instead of relying on the
          // outer catch, so the error message is specific and the request is
          // always answered (never left hanging).
          const errMsg = e instanceof Error ? e.message : String(e);
          setError(`Message signing failed: ${errMsg}`);
          dappConnectStore.rejectRequestById(approvalSessionId, approvalId, `Message signing failed: ${errMsg}`);
          setLoading(false);
          return;
        }
        setPin('');
        return;
      }

      if (method === 'qrl_signTypedData') {
        const parsed = SignTypedDataParamsSchema.safeParse(params);
        if (!parsed.success) {
          setError(`Invalid qrl_signTypedData params: ${formatZodIssues(parsed.error)}`);
          setLoading(false);
          return;
        }
        const [signerParam, payload] = parsed.data;
        const activeAddress = qrlStore.activeAccount?.accountAddress;
        if (!activeAddress) {
          setError('No active account');
          setLoading(false);
          return;
        }
        if (signerParam.toLowerCase() !== activeAddress.toLowerCase()) {
          setError('Signer mismatch: request is for a different account');
          setLoading(false);
          return;
        }
        // Desktop: typed-data signing is not yet supported in the signer (the
        // hasher has not been ported). Surface a clear error instead of any
        // in-renderer fallback. Same signer binding + response reshaping as
        // the message arm, so this is already correct when the hasher lands.
        if (isDesktop) {
          try {
            const result = await desktopSigner.signTypedData(payload, activeAddress, dappOrigin);
            dappConnectStore.approveRequestById(approvalSessionId, approvalId, {
              signature: result.signature,
              publicKey: result.publicKey,
              signer: result.signer,
              digest: result.digest,
              schemeVersion: result.schemeVersion ?? SCHEME_VERSION_TYPED,
              domain: payload.domain,
            });
          } catch (e) {
            const errMsg = e instanceof Error ? e.message : String(e);
            setError('Typed-data signing not yet supported on desktop');
            dappConnectStore.rejectRequestById(approvalSessionId, approvalId, 
              `Typed-data signing not yet supported on desktop: ${errMsg}`,
            );
          }
          setLoading(false);
          return;
        }
        const pinToUse = getNativeInjectedPin() || pin;
        const unlocked = await unlockHexSeed(pinToUse, activeAddress);
        if ('error' in unlocked) {
          if (unlocked.error === 'Incorrect PIN') setPin('');
          setError(unlocked.error);
          setLoading(false);
          return;
        }
        try {
          const result = signTypedData(payload, unlocked.hexSeed);
          dappConnectStore.approveRequestById(approvalSessionId, approvalId, result);
        } catch (e) {
          // Reject the dApp on encode/sign failure so its request is answered
          // rather than left hanging until its own timeout.
          const errMsg = e instanceof Error ? e.message : String(e);
          setError(`Typed data signing failed: ${errMsg}`);
          dappConnectStore.rejectRequestById(approvalSessionId, approvalId, `Typed data signing failed: ${errMsg}`);
          setLoading(false);
          return;
        }
        setPin('');
        return;
      }

      // Default: approve with null
      dappConnectStore.approveRequestById(approvalSessionId, approvalId, null);
      setPin('');
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      // Log the raw cause (bridges to Metro) before toUserFacingError flattens
      // it for display.
      console.log('[DAppConnect] approval error:', errMsg);
      const userError = toUserFacingError(errMsg);
      setError(userError);
      if (currentApproval) {
        const isTxMethod = currentApproval.method === 'qrl_sendTransaction' ||
          currentApproval.method === 'qrl_signTransaction';
        if (isTxMethod && dappConnectStore.txProgress !== 'idle') {
          // Keep modal open to show failed state
          dappConnectStore.setTxProgress('failed', undefined, userError);
          dappConnectStore.sendRejectionResultById(approvalSessionId, approvalId, userError);
        } else {
          dappConnectStore.rejectRequestById(approvalSessionId, approvalId, userError);
        }
      }
    } finally {
      setLoading(false);
    }
  }, [currentApproval, pin, dappConnectStore, qrlStore]);

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

  /**
   * Preview state for the two signing methods. Recomputed when the pending
   * request changes; we pre-validate so the user sees a clear "this request
   * is malformed" reason rather than only learning at Approve time.
   *
   * Must live above the early-return guard below: hook count has to stay
   * stable across renders or React throws #310 ("Rendered more hooks than
   * during the previous render") the first time an approval arrives.
   */
  const signingPreview = useMemo(() => {
    if (!currentApproval) return null;
    const { method } = currentApproval;
    // De-proxy the observable params (see handleApprove): zod's record key
    // check would otherwise trip over MobX's Symbol(mobx administration) key
    // and formatZodIssues would throw while rendering.
    const params = toJS(currentApproval.params);
    if (method === 'qrl_signMessage') {
      const parsed = SignMessageParamsSchema.safeParse(params);
      if (!parsed.success) {
        return { kind: 'invalid' as const, reason: formatZodIssues(parsed.error) };
      }
      try {
        const [, messageHex] = parsed.data;
        const digestHex = bytesToHex(computeMessageDigest(hexToBytes(messageHex)));
        return { kind: 'message' as const, messageHex, digestHex };
      } catch (e) {
        return { kind: 'invalid' as const, reason: e instanceof Error ? e.message : String(e) };
      }
    }
    if (method === 'qrl_signTypedData') {
      const parsed = SignTypedDataParamsSchema.safeParse(params);
      if (!parsed.success) {
        return { kind: 'invalid' as const, reason: formatZodIssues(parsed.error) };
      }
      try {
        const payload = parsed.data[1];
        const digestHex = bytesToHex(computeTypedDataDigest(payload));
        return { kind: 'typed' as const, payload, digestHex };
      } catch (e) {
        return { kind: 'invalid' as const, reason: e instanceof Error ? e.message : String(e) };
      }
    }
    return null;
  }, [currentApproval]);

  if (!currentApproval) return null;

  const { method, params, dappInfo } = currentApproval;
  const label = METHOD_LABELS[method] || method;
  const needsPin = method !== 'qrl_requestAccounts' &&
    method !== 'wallet_addQrlChain' &&
    method !== 'wallet_switchQrlChain';
  const hasNativePin = !!getNativeInjectedPin();
  const isTransaction = method === 'qrl_sendTransaction' || method === 'qrl_signTransaction';

  const isTxInProgress = txProgress !== 'idle';
  const isTxTerminal = txProgress === 'confirmed' || txProgress === 'failed';

  // Transaction details for display during progress
  const txParams = isTransaction ? (params?.[0] as Record<string, unknown> | undefined) : undefined;
  const txDisplayValue = formatQuantaValue(txParams?.['value']);

  return (
    <Dialog open={approvalModalOpen} onOpenChange={(open) => {
      if (open) return;
      // Ignore any close while a signing/broadcast is in flight: the request
      // must resolve first. Answering the dApp with a rejection here would
      // race the desktop's trusted confirm, which can still approve and
      // produce a signature for an already-rejected request.
      if (loading) return;
      if (isTxTerminal) {
        handleDone();
        return;
      }
      if (isTxInProgress) return;
      if (Date.now() - approvalShownAtRef.current < 350) return;
      // An explicit close (the X button) IS an answer: reject, so the dApp is
      // never left hanging on a dismissed card.
      handleReject();
    }}>
      {/* A pending approval demands an explicit answer (Approve / Reject / X).
          Stray clicks elsewhere in the wallet and Escape must not dismiss the
          card: silently swallowing the decision is how requests get answered
          by accident or left dangling. */}
      <DialogContent
        className="max-w-md p-0 gap-0 overflow-hidden"
        onInteractOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => e.preventDefault()}
      >
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
                  View on Explorer <ExternalLink className="h-4 w-4" />
                </a>
              )}

              {/* Transaction details during progress */}
              {txParams && (
                <div className="rounded border bg-muted p-4 text-sm space-y-2">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">To</span>
                    <span className="font-mono text-xs">{formatAddressShort(txParams['to'] as string || '')}</span>
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
              {method === 'qrl_requestAccounts' && (
                <p className="text-sm text-muted-foreground">
                  This dApp wants to view your account address.
                </p>
              )}

              {isTransaction && params?.[0] != null && (
                <DAppTransactionReview params={params[0] as Record<string, unknown>} />
              )}

              {signingPreview?.kind === 'message' && (
                <DAppMessageReview
                  messageHex={signingPreview.messageHex}
                  digestHex={signingPreview.digestHex}
                />
              )}

              {signingPreview?.kind === 'typed' && (
                <DAppTypedDataReview
                  payload={signingPreview.payload}
                  digestHex={signingPreview.digestHex}
                />
              )}

              {signingPreview?.kind === 'invalid' && (
                <div className="rounded-md border border-destructive/40 bg-destructive/5 p-4 text-sm">
                  <p className="mb-1 font-medium text-destructive">Cannot decode this request</p>
                  <p className="text-xs text-muted-foreground break-all">{signingPreview.reason}</p>
                </div>
              )}

              {/* PIN entry is web/native only. On desktop the signer session is
                  already unlocked and signing does not re-prompt. */}
              {needsPin && !hasNativePin && !isDesktop && (
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
