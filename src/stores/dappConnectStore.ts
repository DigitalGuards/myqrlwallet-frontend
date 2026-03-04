/**
 * MobX store for DApp Connect state.
 * Bridges the DAppConnectService singleton with React UI.
 */

import { makeAutoObservable, runInAction } from 'mobx';
import { dappConnectService } from '@/services/dappConnect/DAppConnectService';
import type { DAppSession, PendingDAppRequest } from '@/services/dappConnect/types';

class DAppConnectStore {
  activeSessions: DAppSession[] = [];
  pendingRequests: PendingDAppRequest[] = [];
  /** The currently displayed approval request (shown in modal) */
  currentApproval: PendingDAppRequest | null = null;
  /** Whether the approval modal is open */
  approvalModalOpen = false;
  /** Connection status messages for banners */
  connectionWarnings: Map<string, string> = new Map();

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
  rejectCurrentRequest(message?: string): void {
    if (!this.currentApproval) return;

    dappConnectService.rejectRequest(
      this.currentApproval.sessionId,
      this.currentApproval.id,
      message
    );

    this.removeCurrentApproval();
  }

  /** Remove the current approval and show the next one if any */
  private removeCurrentApproval(): void {
    if (!this.currentApproval) return;

    const { id: currentId, sessionId: currentSessionId } = this.currentApproval;
    this.pendingRequests = this.pendingRequests.filter(
      (r) => !(r.id === currentId && r.sessionId === currentSessionId)
    );

    if (this.pendingRequests.length > 0) {
      this.currentApproval = this.pendingRequests[0];
    } else {
      this.currentApproval = null;
      this.approvalModalOpen = false;
    }
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
