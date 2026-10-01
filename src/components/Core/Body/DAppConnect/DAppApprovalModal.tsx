/**
 * DApp Approval Modal - Full approval/rejection UI rendered in WebView.
 * Single source of truth for all dApp request approvals.
 */

import { useState, useCallback, useEffect, useMemo, useRef } from "react";
import { toJS } from "mobx";
import { observer } from "mobx-react-lite";
import { useStore } from "@/stores/store";
import { quoteFees, type FeeLevel } from "@/stores/qrlStore";
import type { Web3QRLInterface } from "@theqrl/web3";
import {
  assertSignedFeeWithinApproved,
  type ApprovedFee,
} from "@/utils/web3/feePolicy";
import { Dialog, DialogContent } from "@/components/UI/Dialog";
import { Button } from "@/components/UI/Button";
import DAppTransactionReview from "./DAppTransactionReview";
import DAppMessageReview from "./DAppMessageReview";
import DAppTypedDataReview from "./DAppTypedDataReview";
import { utils } from "@theqrl/web3";
import {
  DeviceCredentialUnavailableError,
  decryptStoredSeedWithPin,
} from "@/utils/crypto";
import { getNativeInjectedPin, isIOSNativeApp } from "@/utils/nativeApp";
import { shouldPromptReturnToBrowser } from "./returnToBrowserHint";
import {
  approvedFeeForRequest,
  isFeeApprovalPending,
  type FeePreviewState,
} from "./approvalFeeGate";
import StorageUtil from "@/utils/storage/storage";
import { getExplorerTxUrl, QRL_PROVIDER } from "@/config";
import { IS_V3_PROFILE } from '@/config/runtimeProfile';
import { formatQuantaValue } from "@/utils/formatting";
import { QrlAddress } from "@/components/UI/QrlAddress";
import {
  waitForTransactionReceipt,
} from "@/utils/web3/txPolling";
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
} from "@/utils/signing";
import { Loader, Check, X, ExternalLink, Shield, Globe } from "lucide-react";
import type { TxProgressState } from "@/stores/dappConnectStore";
import type { ZodError } from "zod";
import { isDesktop, desktopSigner, buildDappOrigin } from "@/desktop/bridge";
import { isExactQrlAccount } from "@/services/dappConnect/accountBinding";
import {
  assertRequestedTransactionChain,
  canonicalChainId,
  readWalletChainId,
} from "@/services/dappConnect/rpcProvider";
import { getDAppReceiptStatus, waitForDAppBroadcastSettlement } from "./dappBroadcastSettlement";
import {
  walletMutations,
  type WalletMutationToken,
} from "@/utils/nativeWalletMutation";
import {
  TransactionWouldRevertError,
  asOptionalString,
  assertTransactionWouldNotRevert,
} from "./dappRevertPrecheck";
import { createDAppRequestAnswer } from "./dappRequestAnswer";
import {
  buildReviewedDAppTransaction,
  desktopTransactionArgs,
  requestedGasLimit,
} from "./dappTransaction";

function formatZodIssues(error: ZodError): string {
  // path segments can be symbols (e.g. a MobX admin key surfaced by zod's
  // record key check); String() coerces them safely whereas Array.join would
  // throw "Cannot convert a Symbol value to a string" and crash the render.
  return (
    error.issues
      .map(
        (i) =>
          `${i.path.length ? i.path.map(String).join(".") : "(root)"}: ${i.message}`,
      )
      .join("; ") || "malformed params"
  );
}

const METHOD_LABELS: Record<string, string> = {
  qrl_requestAccounts: "Connect Account",
  qrl_sendTransaction: "Send Transaction",
  qrl_signTransaction: "Sign Transaction",
  qrl_signMessage: "Sign Message",
  qrl_signTypedData: "Sign Typed Data",
  wallet_addQrlChain: "Add Network",
  wallet_switchQrlChain: "Switch Network",
};

const GAS_ESTIMATE_BUFFER_MULTIPLIER = 1.2;
// dApp requests carry no fee selector; sign at the send screen's default level.
const DAPP_FEE_LEVEL: FeeLevel = "medium";

/**
 * The gas limit a dApp transaction will be signed with.
 *
 * Shared by the fee preview and the approve path so the figure shown and the
 * figure signed come from the same rule.
 */
async function resolveDAppGasLimit(
  web3: Web3QRLInterface,
  txParams: Record<string, unknown>,
): Promise<number> {
  const explicitGas = requestedGasLimit(txParams);
  if (explicitGas !== undefined) return Number(explicitGas);
  const data = (txParams["data"] as string) || "0x";
  if (data && data !== "0x") {
    const estimated = await web3.estimateGas({
      from: txParams["from"] as string,
      to: txParams["to"] as string,
      value: (txParams["value"] as string | undefined) ?? "0x0",
      data,
    });
    return Math.ceil(Number(estimated) * GAS_ESTIMATE_BUFFER_MULTIPLIER);
  }
  return 21000;
}

/** "Up to N Quanta", the ceiling rather than the expected cost. */
function formatMaxNetworkFee(gasLimit: number, maxFeePerGas: bigint): string {
  return formatQuantaValue(BigInt(gasLimit) * maxFeePerGas);
}


function toUserFacingError(error: string): string {
  const msg = error.toLowerCase();
  if (msg.includes("insufficient funds")) {
    return "Insufficient funds for this transaction.";
  }
  if (msg.includes("nonce too low")) {
    return "Transaction nonce is too low. Please retry.";
  }
  if (msg.includes("already known")) {
    return "This transaction was already submitted.";
  }
  if (msg.includes("user denied") || msg.includes("rejected")) {
    return "Request was rejected.";
  }
  return "Transaction failed. Please verify details and try again.";
}

/**
 * Shared PIN-unlock: pulls the encrypted seed for `activeAddress` and
 * decrypts it. Callers handle their own UX side effects (progress states,
 * error display); this helper just produces a hexSeed or a reason string.
 */
async function unlockHexSeed(
  pinToUse: string,
  activeAddress: string,
  signingGeneration: WalletMutationToken,
): Promise<{ hexSeed: string } | { error: string }> {
  if (!pinToUse) return { error: "Please enter your PIN" };
  if (!walletMutations.isCurrent(signingGeneration)) {
    return { error: "Wallet changed while preparing the request" };
  }
  const blockchainVal = await StorageUtil.getBlockChain();
  const encryptedSeed = await StorageUtil.getEncryptedSeed(
    blockchainVal,
    activeAddress,
  );
  if (!encryptedSeed) return { error: "No encrypted seed found" };
  try {
    const decrypted = await decryptStoredSeedWithPin(
      blockchainVal,
      activeAddress,
      encryptedSeed,
      pinToUse,
      signingGeneration,
    );
    return { hexSeed: decrypted.hexSeed };
  } catch (error) {
    if (!walletMutations.isCurrent(signingGeneration)) {
      return { error: "Wallet changed while preparing the request" };
    }
    return {
      error:
        error instanceof DeviceCredentialUnavailableError
          ? "Wallet device security credential unavailable; re-import the seed"
          : "Incorrect PIN",
    };
  }
}

function assertSigningGenerationCurrent(token: WalletMutationToken): void {
  if (!walletMutations.isCurrent(token)) {
    throw new Error("Wallet changed while preparing the request");
  }
}

function getBorderColor(progress: TxProgressState): string {
  switch (progress) {
    case "confirming":
      return "border-l-primary";
    case "confirmed":
      return "border-l-success";
    case "failed":
      return "border-l-destructive";
    default:
      return "border-l-secondary";
  }
}

const DAppApprovalModalContent = observer(() => {
  const { dappConnectStore, qrlStore } = useStore();
  const { currentApproval, approvalModalOpen, txProgress, txHash, txError } =
    dappConnectStore;
  /**
   * The maximum network fee for the transaction under review, quoted before
   * the user decides, with the state of that quote.
   *
   * A dApp approval used to show no fee at all, so the user approved a cost
   * they could not see. A preview that is merely absent is not good enough
   * either: while it loaded or after it failed, Approve stayed enabled and the
   * signing guard accepted a missing approved quote, so a later RPC answer
   * could be signed at a fee that was never on screen. The request key ties a
   * ready preview to the request it was quoted for.
   */
  const [feePreview, setFeePreview] = useState<FeePreviewState | null>(null);
  /** Bumped by the retry button to re-run a failed preview. */
  const [feePreviewAttempt, setFeePreviewAttempt] = useState(0);
  const [pin, setPin] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  /**
   * Guards a second approve in the same tick. `loading` is React state and
   * does not update until the next render, so Enter pressed twice quickly
   * would start two signs and two broadcasts.
   */
  const approveInFlightRef = useRef(false);


  // When the current approval changes (a queued request gets promoted after
  // the previous one is answered), briefly ignore dismissals: a double-click
  // on the X must not reject a request the user never saw rendered.
  const approvalShownAtRef = useRef(0);
  /**
   * The fee this approval may sign, read at the moment of the tap.
   *
   * A ref, so the approve callback never holds a stale copy from the render
   * where the quote had not arrived yet, and so the quote arriving does not
   * have to rebuild the callback.
   */
  const approvedFeeRef = useRef<ApprovedFee | undefined>(undefined);
  const approvalKey = currentApproval
    ? `${currentApproval.sessionId}:${currentApproval.id}`
    : "";
  useEffect(() => {
    approvalShownAtRef.current = Date.now();
  }, [approvalKey]);

  const blockchain = qrlStore.qrlConnection.blockchain;

  const handleApprove = useCallback(async () => {
    if (!currentApproval) return;
    // Synchronous, because `loading` is React state and does not update until
    // the next render: a second Enter in the same tick would otherwise start a
    // second sign and broadcast, and pay twice.
    if (approveInFlightRef.current) return;
    approveInFlightRef.current = true;

    setError("");
    setLoading(true);

    // Answer THIS request, never "whatever is current when an await resolves":
    // a session disconnect promotes the next queued request while PIN unlock,
    // the desktop trusted confirm, or a broadcast is in flight, and answering
    // the live currentApproval would route this result to that other request.
    const { sessionId: approvalSessionId, id: approvalId } = currentApproval;
    const isStillCurrent = () =>
      dappConnectStore.isCurrentApproval(approvalSessionId, approvalId);
    const setCurrentTxProgress = (
      state: TxProgressState,
      hash?: string,
      progressError?: string,
    ) =>
      dappConnectStore.setTxProgressForApproval(
        approvalSessionId,
        approvalId,
        state,
        hash,
        progressError,
      );

    // qrl_sendTransaction owes the dApp one thing: the transaction hash, as
    // soon as the node accepts the broadcast. Waiting for the receipt made the
    // answer depend on the wallet still being open a minute later, which on a
    // phone it is not: the user approves, switches back to the dApp, the
    // wallet backgrounds and locks, the relay drops, and a transaction that
    // mined perfectly well is never reported. A user who sees no result sends
    // again and pays twice.
    //
    // Confirmation stays in the wallet as progress, which is a local concern.
    const dAppRequest = createDAppRequestAnswer({
      approve: (result) =>
        dappConnectStore.sendApprovalResultById(approvalSessionId, approvalId, result),
      reject: (message) =>
        dappConnectStore.sendRejectionResultById(approvalSessionId, approvalId, message),
    });
    const answerDApp = (hash: string): void => dAppRequest.answer(hash);
    // Never after an answer: the dApp holds a hash for a transaction that is
    // on its way, and a later revert is something it observes on chain.
    const rejectDApp = (message: string): void => dAppRequest.reject(message);

    const reportUnknownTransaction = (hash: string, message: string) => {
      setCurrentTxProgress("unknown", hash, message);
      if (hash) {
        // A send request can return its broadcast hash while inclusion is unknown.
        answerDApp(hash);
        // Keep looking. An unknown outcome very often turns into a perfectly
        // ordinary receipt a slot later, and resolving it here is what stops
        // the user sending the same transaction twice.
        void watchUnknownTransaction(hash);
      } else {
        rejectDApp(message);
      }
      if (isStillCurrent()) {
        setPin("");
        setLoading(false);
      }
    };

    /**
     * Poll for the receipt of a transaction whose broadcast outcome was never
     * established, and move the wallet off "unknown" if it lands. The dApp
     * already has the hash, so this only updates what the user sees.
     */
    const watchUnknownTransaction = async (hash: string): Promise<void> => {
      const provider = qrlStore.qrlInstance;
      if (!provider) return;
      try {
        const outcome = await waitForTransactionReceipt(
          (candidate) => provider.getTransactionReceipt(candidate),
          hash,
          // Stop as soon as this approval is no longer the one on screen: a
          // close, a session disconnect, a logout or a wallet wipe all end any
          // reason to keep polling, and this otherwise ran for seven minutes.
          { cancelled: () => !isStillCurrent() },
        );
        if (outcome.status !== "receipt") return;
        const succeeded = getDAppReceiptStatus(outcome.receipt, hash);
        if (succeeded === undefined) return;
        if (!isStillCurrent()) return;
        setCurrentTxProgress(
          succeeded ? "confirmed" : "failed",
          hash,
          succeeded ? undefined : "Transaction has been reverted by the QRVM",
        );
      } catch (error) {
        console.log(
          "[DAppConnect] watching an unknown transaction did not complete:",
          error instanceof Error ? error.message : String(error),
        );
      }
    };

    try {
      const { method } = currentApproval;
      if (IS_V3_PROFILE) await qrlStore.assertNetworkReady();
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

      if (method === "qrl_requestAccounts") {
        const activeAddress = qrlStore.activeAccount?.accountAddress;
        dappConnectStore.approveRequestById(
          approvalSessionId,
          approvalId,
          activeAddress ? [activeAddress] : [],
        );
        setPin("");
        return;
      }

      if (method === "wallet_addQrlChain") {
        // This wallet has no durable chain registry. A success response would
        // claim a network was added even though future requests still use the
        // configured provider.
        dappConnectStore.rejectRequestById(
          approvalSessionId,
          approvalId,
          "Adding networks is not supported by this wallet",
          4200,
        );
        setPin("");
        return;
      }

      if (method === "wallet_switchQrlChain") {
        // Desktop is single-network: main builds/signs/broadcasts against its
        // configured RPC + chain id, so honouring a renderer-side switch would
        // silently sign for a different chain than the dApp expects. Reject
        // with 4902 (EIP-3326 unrecognized/unavailable chain) instead of
        // flipping renderer state; 4901 would falsely signal a transient
        // provider disconnect and invite reconnect loops.
        if (isDesktop) {
          dappConnectStore.rejectRequestById(
            approvalSessionId,
            approvalId,
            "The desktop wallet is pinned to its configured chain",
            4902,
          );
          setPin("");
          return;
        }

        try {
          const request = params?.[0] as Record<string, unknown> | undefined;
          const requestedChainId = canonicalChainId(request?.["chainId"]);
          const walletChainId = await readWalletChainId(qrlStore.qrlInstance);
          if (requestedChainId !== walletChainId) {
            dappConnectStore.rejectRequestById(
              approvalSessionId,
              approvalId,
              `The wallet is connected to ${walletChainId} and cannot switch to ${requestedChainId}`,
              4902,
            );
            setPin("");
            return;
          }
        } catch {
          dappConnectStore.rejectRequestById(
            approvalSessionId,
            approvalId,
            "The wallet could not verify the requested network",
            4902,
          );
          setPin("");
          return;
        }
        dappConnectStore.approveRequestById(
          approvalSessionId,
          approvalId,
          null,
        );
        setPin("");
        return;
      }

      if (
        method === "qrl_sendTransaction" ||
        method === "qrl_signTransaction"
      ) {
        const activeAddress = qrlStore.activeAccount?.accountAddress;
        if (!activeAddress) {
          setError("No active account");
          setLoading(false);
          return;
        }

        // Bind the required transaction `from` to the live active account at
        // approve-click. The active account can flip while this approval sits
        // open, so an exact comparison prevents signing for a different wallet.
        const requestedFrom = ((
          params?.[0] as Record<string, unknown> | undefined
        )?.["from"] ?? "") as string;
        if (!isExactQrlAccount(requestedFrom, activeAddress)) {
          setError("Signer mismatch: request is for a different account");
          setLoading(false);
          return;
        }

        await assertRequestedTransactionChain(
          (params?.[0] || {}) as Record<string, unknown>,
          qrlStore.qrlInstance,
        );
        if (!isStillCurrent() || qrlStore.activeAccount?.accountAddress !== activeAddress) {
          throw new Error("Wallet changed while verifying the transaction chain");
        }

        // Desktop: build + confirm + sign in the isolated signer (its own
        // trusted modal), then broadcast for send / return raw for sign. No
        // PIN, no seed in the renderer.
        if (isDesktop) {
          const txParamsD = (params?.[0] || {}) as Record<string, unknown>;
          // One construction for both desktop methods, including the
          // explicitly requested gas limit that the web and mobile path below
          // already honours. Some contract flows need headroom the wallet's own
          // estimate cannot see (QuantaSwap HTLCv3 settlement asks for
          // estimateGas + 250000, and a settlement that runs out of gas defers
          // the payout into a credit). Main builds with max(that, its own
          // buffered estimate), so a too-low request still cannot produce a
          // failing transaction. `from` is the live active account bound above,
          // deliberately ignoring the dApp's own `from`.
          const desktopArgs = desktopTransactionArgs(txParamsD, activeAddress);
          // The receipt wait below can outlive this approval being current (a
          // session disconnect promotes the queue mid-poll); always answer the
          // CAPTURED request, but only paint progress while it is still shown.
          try {
            setCurrentTxProgress("signing");
            if (method === "qrl_signTransaction") {
              const rawTx = await desktopSigner.signTransactionOnly(
                desktopArgs,
                dappOrigin,
              );
              dappConnectStore.approveRequestById(
                approvalSessionId,
                approvalId,
                rawTx,
              );
              return;
            }
            setCurrentTxProgress("broadcasting");
            const { transactionHash } =
              await desktopSigner.signAndSendTransaction(
                desktopArgs,
                dappOrigin,
              );
            // The node accepted the broadcast, so the dApp gets its hash now,
            // the same as the web path. The receipt poll below only drives the
            // wallet's own progress display. The desktop bridge exposes no
            // receipt API, so it polls the renderer's own provider.
            setCurrentTxProgress("confirming", transactionHash);
            answerDApp(transactionHash);

            const web3ForReceipt = qrlStore.qrlInstance;
            if (!web3ForReceipt) {
              reportUnknownTransaction(transactionHash, "Transaction was broadcast, but confirmation is unavailable. Check the explorer before sending again.");
              return;
            }

            const outcome = await waitForTransactionReceipt(
              (hash) => web3ForReceipt.getTransactionReceipt(hash),
              transactionHash,
            );

            const succeeded = outcome.status === "receipt"
              ? getDAppReceiptStatus(outcome.receipt, transactionHash) : undefined;
            if (succeeded === undefined) {
              reportUnknownTransaction(transactionHash, "Transaction was broadcast, but confirmation is unavailable. Check the explorer before sending again.");
              return;
            }
            if (succeeded) {
              setCurrentTxProgress("confirmed", transactionHash);
              return;
            }

            throw new Error("Transaction has been reverted by the QRVM");
          } catch (e) {
            const errMsg = e instanceof Error ? e.message : String(e);
            console.log("[DAppConnect] desktop tx error:", errMsg);
            const userError = toUserFacingError(errMsg);
            setCurrentTxProgress("failed", undefined, userError);
            // A no-op once the hash was answered: a revert after a successful
            // broadcast is not a rejected request.
            rejectDApp(`Transaction failed: ${userError}`);
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
          setError("Please enter your PIN");
          setLoading(false);
          return;
        }

        // Stage: signing
        setCurrentTxProgress("signing");

        const signingGeneration = walletMutations.captureGeneration();
        const unlocked = await unlockHexSeed(
          pinToUse,
          activeAddress,
          signingGeneration,
        );
        if ("error" in unlocked) {
          setError(unlocked.error);
          if (unlocked.error === "Incorrect PIN") {
            // Recoverable: reset to the editable state so the user can retry.
            setPin("");
            if (isStillCurrent()) dappConnectStore.resetTxProgress();
          } else {
            // Non-recoverable (e.g. no stored seed). Answer the dApp so its
            // request does not hang, then show the terminal failed state.
            setCurrentTxProgress("failed", undefined, unlocked.error);
            dappConnectStore.sendRejectionResultById(
              approvalSessionId,
              approvalId,
              unlocked.error,
            );
          }
          setLoading(false);
          return;
        }
        const hexSeed = unlocked.hexSeed;

        const txParams = (params?.[0] || {}) as Record<string, unknown>;
        const web3 = qrlStore.qrlInstance;
        if (!web3) {
          setError("Web3 not initialized");
          setCurrentTxProgress("failed", undefined, "Web3 not initialized");
          dappConnectStore.sendRejectionResultById(
            approvalSessionId,
            approvalId,
            "Web3 not initialized",
          );
          setLoading(false);
          return;
        }

        const nonce = await web3.getTransactionCount(activeAddress, "pending");
        // Same fee policy as the send screen: the node's suggested tip plus
        // base-fee headroom, so a rising base fee cannot strand the tx.
        const fees = await quoteFees(web3, DAPP_FEE_LEVEL);
        const txData = (txParams["data"] as string) || "0x";
        const txValue = (txParams["value"] as string | undefined) ?? "0x0";

        let gas: string | number;
        const explicitGas = requestedGasLimit(txParams);
        if (explicitGas !== undefined) {
          gas = explicitGas;
        } else if (txData && txData !== "0x") {
          const estimated = await web3.estimateGas(
            {
              from: activeAddress,
              to: txParams["to"] as string,
              value: txValue,
              data: txData,
            },
            // Same block tag as the revert pre-check. At `latest` a dApp that
            // sends no gas still had its transaction refused for depending on
            // one that is only in the mempool.
            "pending",
          );
          gas = Math.ceil(Number(estimated) * GAS_ESTIMATE_BUFFER_MULTIPLIER);
        } else {
          gas = 21000;
        }

        // Sign no more than the figure the approval screen showed, as a total.
        // quoteFees already refuses a quote outside the wallet's safety
        // limits; this refuses a price that grew between the preview and the
        // tap, a gas limit that grew after a re-estimate, and an approval with
        // no displayed fee behind it at all. The displayed maximum is
        // gas x maxFeePerGas, so guarding only the price let a tenfold gas
        // increase through at an unchanged price.
        assertSignedFeeWithinApproved(
          { quote: fees, gasLimit: BigInt(gas) },
          approvedFeeRef.current,
        );

        const txObject = buildReviewedDAppTransaction(txParams, {
          gas,
          nonce: Number(nonce),
          maxFeePerGasHex: utils.toHex(fees.maxFeePerGas),
          maxPriorityFeePerGasHex: utils.toHex(fees.maxPriorityFeePerGas),
        });

        // Ask the node whether this would revert before spending gas on it.
        // Answering at broadcast means a doomed transaction would otherwise be
        // reported as accepted and then burn the fee. Advisory: anything other
        // than a clear revert lets the send proceed.
        await assertTransactionWouldNotRevert(web3, {
          from: asOptionalString(txObject["from"]),
          to: asOptionalString(txObject["to"]),
          value: asOptionalString(txObject["value"]),
          data: asOptionalString(txObject["data"]),
          gas: asOptionalString(txObject["gas"]),
        });

        // Stage: broadcasting
        setCurrentTxProgress("broadcasting");

        assertSigningGenerationCurrent(signingGeneration);
        if (IS_V3_PROFILE) await qrlStore.assertNetworkReady(web3);
        await assertRequestedTransactionChain(txParams, web3);
        assertSigningGenerationCurrent(signingGeneration);
        const signedTx = await web3.accounts.signTransaction({ ...txObject,
          ...(IS_V3_PROFILE ? { chainId: QRL_PROVIDER.TEST_NET_V3.expectedChainId } : {}),
        }, hexSeed);
        assertSigningGenerationCurrent(signingGeneration);

        if (!signedTx.rawTransaction) {
          setCurrentTxProgress(
            "failed",
            undefined,
            "Failed to sign transaction",
          );
          dappConnectStore.sendRejectionResultById(
            approvalSessionId,
            approvalId,
            "Failed to sign transaction",
          );
          setLoading(false);
          return;
        }

        if (method === "qrl_signTransaction") {
          assertSigningGenerationCurrent(signingGeneration);
          dappConnectStore.approveRequestById(
            approvalSessionId,
            approvalId,
            signedTx.rawTransaction,
          );
          setPin("");
          setLoading(false);
          return;
        }

        // Use PromiEvent to get real broadcasting → confirming transition
        assertSigningGenerationCurrent(signingGeneration);
        if (IS_V3_PROFILE) await qrlStore.assertNetworkReady(web3);
        assertSigningGenerationCurrent(signingGeneration);
        // web3 runs its own revert check before sending, at `latest`, and
        // blocks the broadcast on any JSON-RPC error including "method does
        // not exist". That made the advisory pending-block check above
        // decorative and the gate that actually decided sit at the wrong
        // block. One gate now: the one above.
        const promiEvent = web3.sendSignedTransaction(
          signedTx.rawTransaction,
          undefined,
          { checkRevertBeforeSending: false },
        );

        await waitForDAppBroadcastSettlement(
          promiEvent,
          {
          onUnknown: reportUnknownTransaction,
          onTransactionHash: (hash) => {
            // The node accepted the broadcast, so the dApp gets its hash now.
            // Everything below this point is the wallet's own progress UI.
            setCurrentTxProgress("confirming", hash);
            answerDApp(hash);
          },
          onSuccess: (hash) => {
            // Normally a no-op, because the hash already answered. It is the
            // backstop for a missed or non-string transactionHash event,
            // which would otherwise leave the request unanswered for good.
            answerDApp(hash);
            setCurrentTxProgress("confirmed", hash);
            if (isStillCurrent()) {
              setPin("");
              setLoading(false);
            }
          },
          onFailure: (txErrMsg) => {
            // Log the raw node/broadcast reason (bridges to Metro as a
            // [WebView] line; console.error does not bridge) since
            // toUserFacingError intentionally hides it from the UI.
            console.log("[DAppConnect] tx broadcast error:", txErrMsg);
            const userError = toUserFacingError(txErrMsg);
            setCurrentTxProgress("failed", undefined, userError);
            // Only a broadcast that never produced a hash is a rejection. A
            // revert after the node accepted the transaction is not: the dApp
            // already holds the hash and observes the outcome on chain.
            rejectDApp(`Transaction failed: ${userError}`);
            if (isStillCurrent()) {
              setPin("");
              setLoading(false);
            }
          },
          },
          {
            // Derived from the signed bytes, so it is known before the
            // broadcast. When the node never answers, this is what the dApp is
            // given rather than a rejection it would act on by sending again.
            localHash:
              typeof signedTx.transactionHash === "string"
                ? signedTx.transactionHash
                : undefined,
          },
        );
        return;
      }

      if (method === "qrl_signMessage") {
        const parsed = SignMessageParamsSchema.safeParse(params);
        if (!parsed.success) {
          setError(
            `Invalid qrl_signMessage params: ${formatZodIssues(parsed.error)}`,
          );
          setLoading(false);
          return;
        }
        const [signerParam, messageHex] = parsed.data;
        const activeAddress = qrlStore.activeAccount?.accountAddress;
        if (!activeAddress) {
          setError("No active account");
          setLoading(false);
          return;
        }
        if (!isExactQrlAccount(signerParam, activeAddress)) {
          setError("Signer mismatch: request is for a different account");
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
            const result = await desktopSigner.signMessage(
              messageHex,
              activeAddress,
              dappOrigin,
            );
            if (!isExactQrlAccount(result.signer, activeAddress)) {
              throw new Error(
                "the desktop signer does not match the requested signer",
              );
            }
            dappConnectStore.approveRequestById(approvalSessionId, approvalId, {
              signature: result.signature,
              publicKey: result.publicKey,
              signer: result.signer,
              ...(result.descriptor ? { descriptor: result.descriptor } : {}),
              digest: result.digest,
              schemeVersion: result.schemeVersion ?? SCHEME_VERSION_MSG,
            });
          } catch (e) {
            const errMsg = e instanceof Error ? e.message : String(e);
            setError(`Message signing failed: ${errMsg}`);
            dappConnectStore.rejectRequestById(
              approvalSessionId,
              approvalId,
              `Message signing failed: ${errMsg}`,
            );
          }
          setLoading(false);
          return;
        }
        const pinToUse = getNativeInjectedPin() || pin;
        const signingGeneration = walletMutations.captureGeneration();
        const unlocked = await unlockHexSeed(
          pinToUse,
          activeAddress,
          signingGeneration,
        );
        if ("error" in unlocked) {
          if (unlocked.error === "Incorrect PIN") setPin("");
          setError(unlocked.error);
          setLoading(false);
          return;
        }
        try {
          assertSigningGenerationCurrent(signingGeneration);
          if (IS_V3_PROFILE) await qrlStore.assertNetworkReady();
          assertSigningGenerationCurrent(signingGeneration);
          const result = signMessage(messageHex, unlocked.hexSeed);
          if (!isExactQrlAccount(result.signer, activeAddress)) {
            throw new Error(
              "the stored seed does not match the requested signer",
            );
          }
          assertSigningGenerationCurrent(signingGeneration);
          dappConnectStore.approveRequestById(
            approvalSessionId,
            approvalId,
            result,
          );
        } catch (e) {
          // Reject the dApp on a signing failure instead of relying on the
          // outer catch, so the error message is specific and the request is
          // always answered (never left hanging).
          const errMsg = e instanceof Error ? e.message : String(e);
          setError(`Message signing failed: ${errMsg}`);
          dappConnectStore.rejectRequestById(
            approvalSessionId,
            approvalId,
            `Message signing failed: ${errMsg}`,
          );
          setLoading(false);
          return;
        }
        setPin("");
        return;
      }

      if (method === "qrl_signTypedData") {
        const parsed = SignTypedDataParamsSchema.safeParse(params);
        if (!parsed.success) {
          setError(
            `Invalid qrl_signTypedData params: ${formatZodIssues(parsed.error)}`,
          );
          setLoading(false);
          return;
        }
        const [signerParam, payload] = parsed.data;
        const activeAddress = qrlStore.activeAccount?.accountAddress;
        if (!activeAddress) {
          setError("No active account");
          setLoading(false);
          return;
        }
        if (!isExactQrlAccount(signerParam, activeAddress)) {
          setError("Signer mismatch: request is for a different account");
          setLoading(false);
          return;
        }
        // Desktop: typed-data signing is not yet supported in the signer (the
        // hasher has not been ported). Surface a clear error instead of any
        // in-renderer fallback. Same signer binding + response reshaping as
        // the message arm, so this is already correct when the hasher lands.
        if (isDesktop) {
          try {
            const result = await desktopSigner.signTypedData(
              payload,
              activeAddress,
              dappOrigin,
            );
            if (!isExactQrlAccount(result.signer, activeAddress)) {
              throw new Error(
                "the desktop signer does not match the requested signer",
              );
            }
            dappConnectStore.approveRequestById(approvalSessionId, approvalId, {
              signature: result.signature,
              publicKey: result.publicKey,
              signer: result.signer,
              ...(result.descriptor ? { descriptor: result.descriptor } : {}),
              digest: result.digest,
              schemeVersion: result.schemeVersion ?? SCHEME_VERSION_TYPED,
              domain: payload.domain,
            });
          } catch (e) {
            const errMsg = e instanceof Error ? e.message : String(e);
            setError("Typed-data signing not yet supported on desktop");
            dappConnectStore.rejectRequestById(
              approvalSessionId,
              approvalId,
              `Typed-data signing not yet supported on desktop: ${errMsg}`,
            );
          }
          setLoading(false);
          return;
        }
        const pinToUse = getNativeInjectedPin() || pin;
        const signingGeneration = walletMutations.captureGeneration();
        const unlocked = await unlockHexSeed(
          pinToUse,
          activeAddress,
          signingGeneration,
        );
        if ("error" in unlocked) {
          if (unlocked.error === "Incorrect PIN") setPin("");
          setError(unlocked.error);
          setLoading(false);
          return;
        }
        try {
          assertSigningGenerationCurrent(signingGeneration);
          if (IS_V3_PROFILE) await qrlStore.assertNetworkReady();
          assertSigningGenerationCurrent(signingGeneration);
          const result = signTypedData(payload, unlocked.hexSeed);
          if (!isExactQrlAccount(result.signer, activeAddress)) {
            throw new Error(
              "the stored seed does not match the requested signer",
            );
          }
          assertSigningGenerationCurrent(signingGeneration);
          dappConnectStore.approveRequestById(
            approvalSessionId,
            approvalId,
            result,
          );
        } catch (e) {
          // Reject the dApp on encode/sign failure so its request is answered
          // rather than left hanging until its own timeout.
          const errMsg = e instanceof Error ? e.message : String(e);
          setError(`Typed data signing failed: ${errMsg}`);
          dappConnectStore.rejectRequestById(
            approvalSessionId,
            approvalId,
            `Typed data signing failed: ${errMsg}`,
          );
          setLoading(false);
          return;
        }
        setPin("");
        return;
      }

      // Default: approve with null
      dappConnectStore.approveRequestById(approvalSessionId, approvalId, null);
      setPin("");
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      // Log the raw cause (bridges to Metro) before toUserFacingError flattens
      // it for display.
      console.log("[DAppConnect] approval error:", errMsg);
      // A revert the wallet caught before signing is a specific, useful
      // answer. Flattening it to "Transaction failed" and code 4001 told the
      // user nothing and told the dApp the user had rejected the request.
      const revert = err instanceof TransactionWouldRevertError ? err : null;
      const userError = revert ? revert.message : toUserFacingError(errMsg);
      if (isStillCurrent()) setError(userError);
      const isTxMethod =
        currentApproval.method === "qrl_sendTransaction" ||
        currentApproval.method === "qrl_signTransaction";
      if (
        isStillCurrent() &&
        isTxMethod &&
        dappConnectStore.txProgress !== "idle"
      ) {
        // Keep modal open to show failed state
        setCurrentTxProgress("failed", undefined, userError);
        dappConnectStore.sendRejectionResultById(
          approvalSessionId,
          approvalId,
          userError,
          // JSON-RPC 3 is "execution reverted"; 4001 means the user rejected,
          // which is a different thing and the dApp acts on it differently.
          revert ? 3 : undefined,
        );
      } else {
        dappConnectStore.rejectRequestById(
          approvalSessionId,
          approvalId,
          userError,
        );
      }
    } finally {
      approveInFlightRef.current = false;
      if (isStillCurrent()) setLoading(false);
    }
  }, [currentApproval, pin, dappConnectStore, qrlStore]);

  const handleReject = useCallback(() => {
    dappConnectStore.rejectCurrentRequest();
    setPin("");
    setError("");
  }, [dappConnectStore]);

  const handleDone = useCallback(() => {
    dappConnectStore.dismissCurrentApproval();
    setPin("");
    setError("");
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
    if (method === "qrl_signMessage") {
      const parsed = SignMessageParamsSchema.safeParse(params);
      if (!parsed.success) {
        return {
          kind: "invalid" as const,
          reason: formatZodIssues(parsed.error),
        };
      }
      try {
        const [, messageHex] = parsed.data;
        const digestHex = bytesToHex(
          computeMessageDigest(hexToBytes(messageHex)),
        );
        return { kind: "message" as const, messageHex, digestHex };
      } catch (e) {
        return {
          kind: "invalid" as const,
          reason: e instanceof Error ? e.message : String(e),
        };
      }
    }
    if (method === "qrl_signTypedData") {
      const parsed = SignTypedDataParamsSchema.safeParse(params);
      if (!parsed.success) {
        return {
          kind: "invalid" as const,
          reason: formatZodIssues(parsed.error),
        };
      }
      try {
        const payload = parsed.data[1];
        const digestHex = bytesToHex(computeTypedDataDigest(payload));
        return { kind: "typed" as const, payload, digestHex };
      } catch (e) {
        return {
          kind: "invalid" as const,
          reason: e instanceof Error ? e.message : String(e),
        };
      }
    }
    return null;
  }, [currentApproval]);

  if (!currentApproval) return null;

  const { method, params, dappInfo } = currentApproval;
  const label = METHOD_LABELS[method] || method;
  const needsPin =
    method !== "qrl_requestAccounts" &&
    method !== "wallet_addQrlChain" &&
    method !== "wallet_switchQrlChain";
  const hasNativePin = !!getNativeInjectedPin();
  const isTransaction =
    method === "qrl_sendTransaction" || method === "qrl_signTransaction";

  const isTxInProgress = txProgress !== "idle";
  const promptReturnToBrowser = shouldPromptReturnToBrowser({
    isIOSNative: isIOSNativeApp(),
    txProgress,
    handedBackToDApp:
      currentApproval !== null &&
      dappConnectStore.returnHandedBackSessionId === currentApproval.sessionId,
  });
  const isTxTerminal = txProgress === "confirmed" || txProgress === "failed" || txProgress === "unknown";

  // Transaction details for display during progress
  const txParams = isTransaction
    ? (params?.[0] as Record<string, unknown> | undefined)
    : undefined;
  const txDisplayValue = formatQuantaValue(txParams?.["value"]);

  // Quote the fee for the transaction under review, so the approval screen can
  // show what it may cost before the user decides. The same quote is handed to
  // the approve path, which refuses to sign a more expensive one.
  const reviewedTxParams = txParams ?? null;
  // The params object identity changes on every render, so the effect keys on
  // its content instead.
  const reviewedTxKey = JSON.stringify(reviewedTxParams);
  const feePreviewKey = `${approvalKey}|${reviewedTxKey}`;
  useEffect(() => {
    if (reviewedTxParams === null) {
      setFeePreview(null);
      return;
    }
    let cancelled = false;
    setFeePreview({ status: "loading", requestKey: feePreviewKey });
    void (async () => {
      try {
        const web3 = qrlStore.qrlInstance;
        if (!web3) throw new Error("Wallet not connected");
        const quote = await quoteFees(web3, DAPP_FEE_LEVEL);
        const gasLimit = await resolveDAppGasLimit(web3, reviewedTxParams);
        if (cancelled) return;
        setFeePreview({
          status: "ready",
          requestKey: feePreviewKey,
          quote,
          gasLimit: BigInt(gasLimit),
          display: formatMaxNetworkFee(gasLimit, quote.maxFeePerGas),
        });
      } catch {
        // A quote the wallet refuses, or a node that will not answer. Approve
        // stays disabled: signing here would mean signing a fee that was never
        // shown. The user can retry the quote.
        if (!cancelled) {
          setFeePreview({ status: "failed", requestKey: feePreviewKey });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
    // reviewedTxParams is covered by reviewedTxKey, inside feePreviewKey.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [feePreviewKey, qrlStore.qrlInstance, feePreviewAttempt]);

  /**
   * The fee this approval is allowed to sign, or undefined.
   *
   * Only a successful quote for THIS request counts. The signing guard fails
   * closed on undefined, so a stale or failed preview cannot be signed against.
   */
  const approvedFee = useMemo<ApprovedFee | undefined>(
    () => approvedFeeForRequest(feePreview, feePreviewKey),
    [feePreview, feePreviewKey],
  );
  const feeApprovalPending = isFeeApprovalPending({
    isDesktop,
    isTransaction,
    approvedFee,
  });
  useEffect(() => {
    approvedFeeRef.current = approvedFee;
  }, [approvedFee]);

  return (
    <Dialog
      open={approvalModalOpen}
      onOpenChange={(open) => {
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
      }}
    >
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
        <div className="bg-gradient-to-r from-primary/10 to-transparent p-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-secondary/10">
              <Globe className="h-5 w-5 text-secondary" />
            </div>
            <div className="min-w-0 flex-1">
              <h3 className="font-semibold text-foreground truncate">
                {dappInfo.name}
              </h3>
              <p className="text-xs text-muted-foreground truncate">
                {dappInfo.url}
              </p>
            </div>
            <div className="flex items-center gap-1 rounded-full bg-secondary/10 px-2 py-1">
              <Shield className="h-3 w-3 text-secondary" />
              <span className="text-xs text-secondary font-medium">
                {label}
              </span>
            </div>
          </div>
        </div>

        {/* Content area with state-based accent border */}
        <div
          className={`border-l-4 ${getBorderColor(txProgress)} mx-4 my-3 pl-4 space-y-4`}
        >
          {/* Transaction progress states */}
          {isTxInProgress ? (
            <div className="space-y-4">
              {/* Progress status row */}
              <div className="flex items-center gap-3 py-2">
                {txProgress === "signing" && (
                  <>
                    <Loader className="h-5 w-5 animate-spin text-secondary" />
                    <span className="text-sm font-medium">
                      Signing transaction...
                    </span>
                  </>
                )}
                {txProgress === "broadcasting" && (
                  <>
                    <Loader className="h-5 w-5 animate-spin text-secondary" />
                    <span className="text-sm font-medium">
                      Broadcasting to network...
                    </span>
                  </>
                )}
                {txProgress === "confirming" && (
                  <>
                    <Loader className="h-5 w-5 animate-spin text-primary" />
                    <span className="text-sm font-medium">
                      Awaiting confirmation...
                    </span>
                  </>
                )}
                {txProgress === "confirmed" && (
                  <>
                    <Check className="h-5 w-5 text-success" />
                    <span className="text-sm font-medium text-success">
                      Transaction Confirmed
                    </span>
                  </>
                )}
                {txProgress === "failed" && (
                  <>
                    <X className="h-5 w-5 text-destructive" />
                    <span className="text-sm font-medium text-destructive">
                      Transaction Failed
                    </span>
                  </>
                )}
                {txProgress === "unknown" && (
                  <span className="text-sm font-medium text-muted-foreground">
                    Outcome unknown, check the explorer
                  </span>
                )}
              </div>

              {/* Same-device iOS: nothing brings the browser forward there. */}
              {promptReturnToBrowser && (
                <p className="text-sm text-muted-foreground">
                  Return to your browser to continue.
                </p>
              )}

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
                    <QrlAddress
                      address={(txParams["to"] as string) || ""}
                      mode="full"
                      className="max-w-[75%] justify-end text-right"
                      addressClassName="text-xs"
                    />
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Value</span>
                    <span className="font-numeric font-semibold">{txDisplayValue}</span>
                  </div>
                </div>
              )}

              {/* Error message for failed state */}
              {txProgress === "failed" && txError && (
                <p className="text-sm text-destructive break-all">{txError}</p>
              )}
              {txProgress === "unknown" && txError && (
                <p className="text-sm text-muted-foreground break-all">{txError}</p>
              )}
            </div>
          ) : (
            /* Normal approval content (before tx progress starts) */
            <div className="space-y-4">
              {method === "qrl_requestAccounts" && (
                <p className="text-sm text-muted-foreground">
                  This dApp wants to view your account address.
                </p>
              )}

              {isTransaction && params?.[0] != null && (
                <DAppTransactionReview
                  params={params[0] as Record<string, unknown>}
                  maxNetworkFee={
                    feePreview?.status === "ready"
                      ? feePreview.display
                      : undefined
                  }
                />
              )}

              {isTransaction && feePreview?.status === "loading" && (
                <p className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader className="h-4 w-4 animate-spin" />
                  Checking the network fee...
                </p>
              )}

              {isTransaction && feePreview?.status === "failed" && (
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm text-destructive">
                    The network fee could not be checked, so this cannot be
                    approved yet.
                  </p>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setFeePreviewAttempt((count) => count + 1)}
                  >
                    Retry
                  </Button>
                </div>
              )}

              {signingPreview?.kind === "message" && (
                <DAppMessageReview
                  messageHex={signingPreview.messageHex}
                  digestHex={signingPreview.digestHex}
                />
              )}

              {signingPreview?.kind === "typed" && (
                <DAppTypedDataReview
                  payload={signingPreview.payload}
                  digestHex={signingPreview.digestHex}
                />
              )}

              {signingPreview?.kind === "invalid" && (
                <div className="rounded-md border border-destructive/40 bg-destructive/5 p-4 text-sm">
                  <p className="mb-1 font-medium text-destructive">
                    Cannot decode this request
                  </p>
                  <p className="text-xs text-muted-foreground break-all">
                    {signingPreview.reason}
                  </p>
                </div>
              )}

              {/* PIN entry is web/native only. On desktop the signer session is
                  already unlocked and signing does not re-prompt. */}
              {needsPin && !hasNativePin && !isDesktop && (
                <div>
                  <label className="mb-1 block text-sm font-medium">
                    Enter PIN to sign
                  </label>
                  <input
                    type="password"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    maxLength={6}
                    autoComplete="one-time-code"
                    value={pin}
                    onChange={(e) => {
                      setPin(e.target.value);
                      setError("");
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && pin && !loading) {
                        void handleApprove();
                      }
                    }}
                    placeholder="Enter PIN"
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                    autoFocus
                  />
                </div>
              )}

              {error && <p className="text-sm text-destructive">{error}</p>}
            </div>
          )}
        </div>

        {/* Footer buttons */}
        <div className="border-t border-border px-4 py-4">
          {isTxTerminal ? (
            <Button onClick={handleDone} className="w-full">
              {txProgress === "confirmed" ? "Done" : "Close"}
            </Button>
          ) : isTxInProgress ? (
            <p className="text-center text-xs text-muted-foreground">
              Please wait while the transaction is being processed...
            </p>
          ) : (
            <div className="grid grid-cols-2 gap-4">
              <Button
                variant="outline"
                onClick={handleReject}
                disabled={loading}
              >
                Reject
              </Button>
              <Button
                onClick={handleApprove}
                disabled={loading || feeApprovalPending}
                // A transaction cannot be approved before its fee is on
                // screen: approving while the quote is loading or failed is
                // approving a cost the user was never shown.
                title={
                  feeApprovalPending
                    ? "Waiting for the network fee"
                    : undefined
                }
              >
                {loading ? "Processing..." : "Approve"}
              </Button>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
});

const DAppApprovalModal = observer(() => {
  const { dappConnectStore } = useStore();
  const approval = dappConnectStore.currentApproval;
  const approvalKey = approval
    ? `${approval.sessionId}:${approval.id}`
    : "none";
  return <DAppApprovalModalContent key={approvalKey} />;
});

export default DAppApprovalModal;
