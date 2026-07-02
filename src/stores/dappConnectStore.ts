/**
 * MobX store for DApp Connect state.
 * Bridges the DAppConnectService singleton with React UI.
 */

import { makeAutoObservable, runInAction } from 'mobx';
import { dappConnectService, DAppConnectService } from '@/services/dappConnect/DAppConnectService';
import type { DAppSession, PendingDAppRequest } from '@/services/dappConnect/types';
import { isDesktop, desktopSigner } from '@/desktop/bridge';

export type TxProgressState = 'idle' | 'signing' | 'broadcasting' | 'confirming' | 'confirmed' | 'failed';

/** How a desktop connect URI reached the wallet (protocol handler vs paste). */
export type DesktopConnectSource = 'deeplink' | 'paste';

class DAppConnectStore {
  activeSessions: DAppSession[] = [];
  pendingRequests: PendingDAppRequest[] = [];
  /** The currently displayed approval request (shown in modal) */
  currentApproval: PendingDAppRequest | null = null;
  /** Whether the approval modal is open */
  approvalModalOpen = false;
  /** Connection status messages for banners */
  connectionWarnings: Map<string, string> = new Map();
  /** Transaction progress state for approval modal */
  txProgress: TxProgressState = 'idle';
  txHash: string | null = null;
  txError: string | null = null;
  /**
   * Desktop only: a qrlconnect:// URI awaiting the user's consent (from the
   * OS protocol handler or the paste field). The consent modal observes this;
   * NO relay contact happens until the user confirms. Latest request wins.
   */
  desktopConnectUri: string | null = null;
  desktopConnectSource: DesktopConnectSource = 'deeplink';

  constructor() {
    makeAutoObservable(this);

    // Wire up service callbacks
    dappConnectService.setHandlers({
      onSessionsChanged: () => {
        runInAction(() => {
          this.activeSessions = dappConnectService.getActiveSessions();
        });
      },
      onPendingRequest: (request) => {
        runInAction(() => {
          this.pendingRequests.push(request);
          // Auto-show approval modal for the first pending request
          if (!this.currentApproval) {
            this.currentApproval = request;
            this.approvalModalOpen = true;
          }
        });
        // Desktop analogue of the mobile DAPP_SHOW_WEBVIEW contract: a
        // restricted request arriving while the window is hidden/unfocused
        // flashes the taskbar (main is rate-limited; never steals focus).
        if (
          isDesktop &&
          (document.visibilityState === 'hidden' || !document.hasFocus())
        ) {
          void desktopSigner.dappRequestAttention().catch(() => undefined);
        }
      },
      onSessionConnected: (sessionId) => {
        runInAction(() => {
          this.connectionWarnings.delete(sessionId);
        });
      },
      onSessionDisconnected: (sessionId) => {
        runInAction(() => {
          this.connectionWarnings.delete(sessionId);
          // Remove any pending requests for this session
          this.pendingRequests = this.pendingRequests.filter(
            (r) => r.sessionId !== sessionId
          );
          if (this.currentApproval?.sessionId === sessionId) {
            this.currentApproval = null;
            this.approvalModalOpen = false;
          }
        });
      },
    });

    // Load existing sessions and reconnect
    this.activeSessions = dappConnectService.getActiveSessions();
    if (this.activeSessions.length > 0) {
      // Auto-reconnect stored sessions on page load
      dappConnectService.reconnectAll();
    }
  }

  /** Handle a qrlconnect:// URI */
  async handleConnectionURI(uri: string): Promise<{ success: boolean; error?: string }> {
    return dappConnectService.handleConnectionURI(uri);
  }

  /**
   * Desktop: stage a qrlconnect:// URI behind the consent modal. Called by
   * the protocol-handler bridge and the paste field; the consent modal is the
   * single gate before any relay contact.
   */
  requestDesktopConnect(uri: string, source: DesktopConnectSource = 'deeplink'): void {
    if (!DAppConnectService.isConnectionURI(uri)) return;
    this.desktopConnectUri = uri;
    this.desktopConnectSource = source;
  }

  /** Desktop: dismiss the staged connect request (consent declined/finished). */
  clearDesktopConnect(): void {
    this.desktopConnectUri = null;
  }

  /**
   * Desktop: user consented in the modal. Runs the normal connect path; the
   * 'deeplink' origin only ever gates the native return-to-dApp redirect,
   * which is a no-op outside the mobile app, so paste + deeplink both map to
   * their honest origin ('qr' for paste: the dApp may be on another device).
   */
  async confirmDesktopConnect(): Promise<{ success: boolean; error?: string }> {
    const uri = this.desktopConnectUri;
    if (!uri) return { success: false, error: 'No pending connection' };
    const origin = this.desktopConnectSource === 'deeplink' ? 'deeplink' : 'qr';
    const result = await dappConnectService.handleConnectionURI(uri, origin);
    runInAction(() => {
      if (result.success) this.desktopConnectUri = null;
    });
    return result;
  }

  /** Approve the current request with a result */
  approveCurrentRequest(result: unknown): void {
    if (!this.currentApproval) return;

    dappConnectService.approveRequest(
      this.currentApproval.sessionId,
      this.currentApproval.id,
      result
    );

    this.removeCurrentApproval();
  }

  /** Reject the current request */
  rejectCurrentRequest(message?: string, code?: number): void {
    if (!this.currentApproval) return;

    dappConnectService.rejectRequest(
      this.currentApproval.sessionId,
      this.currentApproval.id,
      message,
      code
    );

    this.removeCurrentApproval();
  }

  /** Send approval result to dApp without closing the modal (for progress UI) */
  sendApprovalResult(result: unknown): void {
    if (!this.currentApproval) return;
    dappConnectService.approveRequest(
      this.currentApproval.sessionId,
      this.currentApproval.id,
      result
    );
  }

  /** Send rejection to dApp without closing the modal (for progress UI) */
  sendRejectionResult(message?: string): void {
    if (!this.currentApproval) return;
    dappConnectService.rejectRequest(
      this.currentApproval.sessionId,
      this.currentApproval.id,
      message
    );
  }

  /** Dismiss the current approval after tx progress is done (called from "Done"/"Close" button) */
  dismissCurrentApproval(): void {
    this.removeCurrentApproval();
  }

  /** Remove the current approval and show the next one if any */
  private removeCurrentApproval(): void {
    if (!this.currentApproval) return;

    this.resetTxProgress();

    const { id: currentId, sessionId: currentSessionId } = this.currentApproval;
    this.pendingRequests = this.pendingRequests.filter(
      (r) => !(r.id === currentId && r.sessionId === currentSessionId)
    );

    if (this.pendingRequests.length > 0) {
      this.currentApproval = this.pendingRequests[0] ?? null;
    } else {
      this.currentApproval = null;
      this.approvalModalOpen = false;
    }
  }

  /** Update transaction progress state */
  setTxProgress(state: TxProgressState, txHash?: string, error?: string): void {
    this.txProgress = state;
    if (txHash !== undefined) this.txHash = txHash;
    if (error !== undefined) this.txError = error;
  }

  /** Reset transaction progress to idle */
  resetTxProgress(): void {
    this.txProgress = 'idle';
    this.txHash = null;
    this.txError = null;
  }

  /** Close the approval modal without approving/rejecting */
  closeApprovalModal(): void {
    this.approvalModalOpen = false;
  }

  /** Disconnect a specific dApp session */
  disconnectSession(channelId: string): void {
    dappConnectService.disconnectSession(channelId);
  }

  /** Disconnect all sessions */
  disconnectAll(): void {
    dappConnectService.disconnectAll();
  }

  /** Reconnect all stored sessions */
  async reconnectAll(): Promise<void> {
    await dappConnectService.reconnectAll();
  }

  /** Number of active sessions */
  get sessionCount(): number {
    return this.activeSessions.length;
  }

  /** Whether there are any pending approvals */
  get hasPendingApprovals(): boolean {
    return this.pendingRequests.length > 0;
  }
}

export default DAppConnectStore;
