/**
 * Unit tests for DAppConnectStore: the desktop consent staging flow
 * (requestDesktopConnect / confirmDesktopConnect), the approval queue, and
 * the approve/reject passthrough to the service (including the EIP-1193
 * error-code plumbing the desktop chain-pinning path relies on).
 *
 * The DAppConnectService singleton is mocked at the module seam: its real
 * module transitively imports the whole wallet store graph (qrlStore,
 * import.meta.env config), which jest's node runtime cannot load, and these
 * tests are about the store's contract with the service, not the service.
 */

import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import type { DAppSession, PendingDAppRequest } from '@/services/dappConnect/types';
import { SessionStatus } from '@/services/dappConnect/types';

jest.mock('@/services/dappConnect/DAppConnectService', () => {
  const dappConnectService = {
    setHandlers: jest.fn(),
    getActiveSessions: jest.fn(() => []),
    reconnectAll: jest.fn(async () => undefined),
    handleConnectionURI: jest.fn(async () => ({ success: true })),
    approveRequest: jest.fn(),
    rejectRequest: jest.fn(),
    disconnectSession: jest.fn(async () => undefined),
    disconnectAll: jest.fn(async () => undefined),
  };
  class DAppConnectService {
    // Mirrors the real static (a one-line scheme regex); re-declared here so
    // the mock factory does not have to load the real module graph.
    static isConnectionURI(uri: string): boolean {
      return /^qrlconnect:/i.test(uri);
    }
  }
  return { dappConnectService, DAppConnectService };
});

jest.mock('@/desktop/bridge', () => ({
  isDesktop: false,
  desktopSigner: {
    dappRequestAttention: jest.fn(async () => undefined),
  },
}));

import DAppConnectStore from '@/stores/dappConnectStore';
import { dappConnectService } from '@/services/dappConnect/DAppConnectService';

const mockService = jest.mocked(dappConnectService);

const URI_A = 'qrlconnect://?q=blobA';
const URI_B = 'qrlconnect://?q=blobB';

function makeSession(): DAppSession {
  return {
    version: 2,
    id: 'c1',
    dappInfo: { name: 'Test dApp', url: 'https://a.example', chainId: '0x1' },
    connectedAccount: 'Q0000000000000000000000000000000000000000',
    keyExchange: {
      cid: 'c1',
      kAeadRaw: '',
      htx: '',
      sendDir: 'w2d',
      recvDir: 'd2w',
      sendSeq: 0,
      recvSeq: 0,
    },
    status: SessionStatus.CONNECTED,
    createdAt: 0,
    lastActivity: 0,
  };
}

function makeRequest(overrides: Partial<PendingDAppRequest> = {}): PendingDAppRequest {
  return {
    id: 1,
    sessionId: 'session-1',
    method: 'qrl_signMessage',
    params: [],
    dappInfo: { name: 'Test dApp', url: 'https://a.example', chainId: '0x1' },
    timestamp: 0,
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockService.getActiveSessions.mockReturnValue([]);
  mockService.handleConnectionURI.mockResolvedValue({ success: true });
});

describe('constructor wiring', () => {
  it('registers service handlers and loads sessions without reconnect when none stored', () => {
    new DAppConnectStore();
    expect(mockService.setHandlers).toHaveBeenCalledTimes(1);
    expect(mockService.reconnectAll).not.toHaveBeenCalled();
  });

  it('auto-reconnects when stored sessions exist', () => {
    mockService.getActiveSessions.mockReturnValue([makeSession()]);
    const store = new DAppConnectStore();
    expect(store.sessionCount).toBe(1);
    expect(mockService.reconnectAll).toHaveBeenCalledTimes(1);
  });
});

describe('requestDesktopConnect', () => {
  it('stages a valid URI with its source', () => {
    const store = new DAppConnectStore();
    store.requestDesktopConnect(URI_A, 'paste');
    expect(store.desktopConnectUri).toBe(URI_A);
    expect(store.desktopConnectSource).toBe('paste');
  });

  it('defaults the source to deeplink', () => {
    const store = new DAppConnectStore();
    store.requestDesktopConnect(URI_A);
    expect(store.desktopConnectSource).toBe('deeplink');
  });

  it('drops a non-qrlconnect URI with a warning and stages nothing', () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      const store = new DAppConnectStore();
      store.requestDesktopConnect('https://evil.example/?q=x', 'deeplink');
      expect(store.desktopConnectUri).toBeNull();
      expect(warn).toHaveBeenCalledTimes(1);
    } finally {
      warn.mockRestore();
    }
  });

  it('latest request wins while consent is pending', () => {
    const store = new DAppConnectStore();
    store.requestDesktopConnect(URI_A, 'deeplink');
    store.requestDesktopConnect(URI_B, 'paste');
    expect(store.desktopConnectUri).toBe(URI_B);
    expect(store.desktopConnectSource).toBe('paste');
  });

  it('stages a web fragment-link URI with the link source', () => {
    const store = new DAppConnectStore();
    store.requestDesktopConnect(URI_A, 'link');
    expect(store.desktopConnectUri).toBe(URI_A);
    expect(store.desktopConnectSource).toBe('link');
  });

  it('latest request wins across web sources too (link then paste)', () => {
    const store = new DAppConnectStore();
    store.requestDesktopConnect(URI_A, 'link');
    store.requestDesktopConnect(URI_B, 'paste');
    expect(store.desktopConnectUri).toBe(URI_B);
    expect(store.desktopConnectSource).toBe('paste');
  });
});

describe('clearDesktopConnect', () => {
  it('dismisses the staged URI', () => {
    const store = new DAppConnectStore();
    store.requestDesktopConnect(URI_A);
    store.clearDesktopConnect();
    expect(store.desktopConnectUri).toBeNull();
  });
});

describe('confirmDesktopConnect', () => {
  it('fails without touching the service when nothing is staged', async () => {
    const store = new DAppConnectStore();
    const result = await store.confirmDesktopConnect();
    expect(result).toEqual({ success: false, error: 'No pending connection' });
    expect(mockService.handleConnectionURI).not.toHaveBeenCalled();
  });

  it('maps a deeplink source to the deeplink origin and clears on success', async () => {
    const store = new DAppConnectStore();
    store.requestDesktopConnect(URI_A, 'deeplink');
    const result = await store.confirmDesktopConnect();
    expect(result.success).toBe(true);
    expect(mockService.handleConnectionURI).toHaveBeenCalledWith(URI_A, 'deeplink');
    expect(store.desktopConnectUri).toBeNull();
  });

  it('maps a paste source to the qr origin (dApp may be on another device)', async () => {
    const store = new DAppConnectStore();
    store.requestDesktopConnect(URI_A, 'paste');
    await store.confirmDesktopConnect();
    expect(mockService.handleConnectionURI).toHaveBeenCalledWith(URI_A, 'qr');
  });

  it('maps a web link source to the qr origin (dApp may be in another tab)', async () => {
    const store = new DAppConnectStore();
    store.requestDesktopConnect(URI_A, 'link');
    await store.confirmDesktopConnect();
    expect(mockService.handleConnectionURI).toHaveBeenCalledWith(URI_A, 'qr');
  });

  it('keeps the staged URI when the connect fails (modal shows the error)', async () => {
    mockService.handleConnectionURI.mockResolvedValue({ success: false, error: 'relay down' });
    const store = new DAppConnectStore();
    store.requestDesktopConnect(URI_A, 'paste');
    const result = await store.confirmDesktopConnect();
    expect(result).toEqual({ success: false, error: 'relay down' });
    expect(store.desktopConnectUri).toBe(URI_A);
  });

  it('does not clobber a newer URI staged during the awaited handshake', async () => {
    // Regression guard: URI B arrives (protocol handler) while URI A's
    // handshake is in flight. A's success must not clear B, or B's consent
    // modal would never appear and the request would vanish silently.
    const store = new DAppConnectStore();
    store.requestDesktopConnect(URI_A, 'deeplink');
    mockService.handleConnectionURI.mockImplementation(async () => {
      store.requestDesktopConnect(URI_B, 'deeplink');
      return { success: true };
    });
    const result = await store.confirmDesktopConnect();
    expect(result.success).toBe(true);
    expect(store.desktopConnectUri).toBe(URI_B);
  });
});

describe('approval queue passthrough', () => {
  it('approveCurrentRequest forwards the result and advances the queue', () => {
    const store = new DAppConnectStore();
    const first = makeRequest({ id: 1 });
    const second = makeRequest({ id: 2 });
    store.pendingRequests = [first, second];
    store.currentApproval = first;
    store.approvalModalOpen = true;

    store.approveCurrentRequest('0xresult');

    expect(mockService.approveRequest).toHaveBeenCalledWith('session-1', 1, '0xresult');
    // mobx wraps queued requests in observable proxies; compare identity.
    expect(store.currentApproval?.id).toBe(second.id);
    expect(store.approvalModalOpen).toBe(true);
  });

  it('rejectCurrentRequest forwards message AND error code (desktop 4902 chain pinning)', () => {
    const store = new DAppConnectStore();
    const req = makeRequest({ method: 'wallet_switchQrlChain' });
    store.pendingRequests = [req];
    store.currentApproval = req;

    store.rejectCurrentRequest('The desktop wallet is pinned to its configured chain', 4902);

    expect(mockService.rejectRequest).toHaveBeenCalledWith(
      'session-1',
      1,
      'The desktop wallet is pinned to its configured chain',
      4902
    );
    expect(store.currentApproval).toBeNull();
    expect(store.approvalModalOpen).toBe(false);
  });

  it('rejectCurrentRequest with no code leaves the code to the service default (4001)', () => {
    const store = new DAppConnectStore();
    const req = makeRequest();
    store.pendingRequests = [req];
    store.currentApproval = req;

    store.rejectCurrentRequest('User rejected');

    expect(mockService.rejectRequest).toHaveBeenCalledWith('session-1', 1, 'User rejected', undefined);
  });

  it('sendApprovalResultById keeps the modal open (progress UI)', () => {
    const store = new DAppConnectStore();
    const req = makeRequest();
    store.pendingRequests = [req];
    store.currentApproval = req;
    store.approvalModalOpen = true;

    store.sendApprovalResultById(req.sessionId, req.id, '0xhash');

    expect(mockService.approveRequest).toHaveBeenCalledWith('session-1', 1, '0xhash');
    expect(store.currentApproval?.id).toBe(req.id);
    expect(store.approvalModalOpen).toBe(true);
  });

  it('approveRequestById answers the captured request, not the promoted one', () => {
    // The wrong-request race: request A is approved, its async signing is in
    // flight, A's session disconnects and request B becomes current. The
    // resolution must answer A (already gone) and leave B untouched.
    const store = new DAppConnectStore();
    const reqA = makeRequest();
    const reqB = { ...makeRequest(), id: 2, sessionId: 'session-2' };
    store.pendingRequests = [reqA, reqB];
    store.currentApproval = reqA;
    store.approvalModalOpen = true;

    // Captured before the await (what the modal does).
    const { sessionId, id } = reqA;

    // Session A dies mid-flight; B is promoted.
    store.pendingRequests = [reqB];
    store.currentApproval = reqB;

    store.approveRequestById(sessionId, id, '0xsig');

    expect(mockService.approveRequest).toHaveBeenCalledWith('session-1', 1, '0xsig');
    expect(store.currentApproval?.id).toBe(reqB.id);
    expect(store.approvalModalOpen).toBe(true);
    expect(store.pendingRequests).toEqual([reqB]);
  });

  it('is a no-op with no current approval', () => {
    const store = new DAppConnectStore();
    store.approveCurrentRequest('x');
    store.rejectCurrentRequest('y', 4001);
    expect(mockService.approveRequest).not.toHaveBeenCalled();
    expect(mockService.rejectRequest).not.toHaveBeenCalled();
  });
});

describe('service handler callbacks', () => {
  function capturedHandlers() {
    const call = mockService.setHandlers.mock.calls[0];
    if (!call) throw new Error('setHandlers not called');
    return call[0] as {
      onPendingRequest: (r: PendingDAppRequest) => void;
      onSessionDisconnected: (sessionId: string) => void;
      hasPendingApprovalsForChannel: (channelId: string) => boolean;
    };
  }

  it('onPendingRequest queues and auto-shows the first request only', () => {
    const store = new DAppConnectStore();
    const handlers = capturedHandlers();
    const first = makeRequest({ id: 1 });
    const second = makeRequest({ id: 2 });

    handlers.onPendingRequest(first);
    handlers.onPendingRequest(second);

    expect(store.pendingRequests).toHaveLength(2);
    expect(store.currentApproval?.id).toBe(first.id);
    expect(store.approvalModalOpen).toBe(true);
  });

  it('onSessionDisconnected clears that session\'s pending requests and modal', () => {
    const store = new DAppConnectStore();
    const handlers = capturedHandlers();
    const mine = makeRequest({ id: 1, sessionId: 'session-1' });
    const other = makeRequest({ id: 2, sessionId: 'session-2' });
    handlers.onPendingRequest(mine);
    handlers.onPendingRequest(other);

    handlers.onSessionDisconnected('session-1');

    expect(store.pendingRequests.map((r) => r.id)).toEqual([other.id]);
    expect(store.currentApproval).toBeNull();
    expect(store.approvalModalOpen).toBe(false);
  });

  it('hasPendingApprovalsForChannel reflects per-channel pending state', () => {
    const store = new DAppConnectStore();
    const handlers = capturedHandlers();
    expect(handlers.hasPendingApprovalsForChannel('session-1')).toBe(false);

    handlers.onPendingRequest(makeRequest({ id: 1, sessionId: 'session-1' }));
    expect(handlers.hasPendingApprovalsForChannel('session-1')).toBe(true);
    expect(handlers.hasPendingApprovalsForChannel('session-2')).toBe(false);

    handlers.onSessionDisconnected('session-1');
    expect(handlers.hasPendingApprovalsForChannel('session-1')).toBe(false);
    expect(store.pendingRequests).toHaveLength(0);
  });
});
