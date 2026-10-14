/** @jest-environment jsdom */
import { afterEach, beforeEach, expect, it, jest } from '@jest/globals';
import { cleanup, render, waitFor } from '@testing-library/react';
import NativeAppBridge from '../NativeAppBridge';
import { dappConnectService } from '@/services/dappConnect/DAppConnectService';
import { walletMutations } from '@/utils/nativeWalletMutation';
import StorageUtil from '@/utils/storage/storage';
import {
  confirmWalletCleared,
  logToNative,
  sendPinChanged,
  sendPinVerified,
  sendToNative,
  subscribeToNativeMessages,
  type NativeMessage,
} from '@/utils/nativeApp';

const mockNavigate = jest.fn<(path: string) => void | Promise<void>>();
const mockError = jest.fn<(message: string, ...details: unknown[]) => void>();

jest.mock('react-router', () => ({
  useNavigate: () => mockNavigate,
  useLocation: () => ({ search: '?keep=1' }),
}));
jest.mock('@/utils/nativeApp', () => ({
  isInNativeApp: () => true,
  subscribeToNativeMessages: jest.fn(),
  confirmWalletCleared: jest.fn(),
  clearNativeInjectedPin: jest.fn(),
  clearNativeInjectedPinForAppState: jest.fn(),
  hasNativeInjectedPin: () => false,
  notifyWebAppReady: jest.fn(),
  logToNative: jest.fn(),
  sendPinChanged: jest.fn(),
  sendPinVerified: jest.fn(),
  sendToNative: jest.fn(),
  dispatchQRResult: () => false,
}));
jest.mock('@/utils/storage/storage', () => ({
  __esModule: true,
  default: {
    clearActiveAccount: () => Promise.resolve(),
    clearTransactionValues: () => Promise.resolve(),
    clearAllEncryptedSeeds: jest.fn(),
    clearAccountList: jest.fn(),
    clearAllTokenData: jest.fn(),
    clearAllNftData: jest.fn(),
    getActiveAccount: () => Promise.resolve(''),
    getAllEncryptedSeeds: () => Promise.resolve([]),
    getAccountList: () => Promise.resolve([]),
    getWalletSettings: jest.fn(() =>
      Promise.resolve({
        autoLockTimeout: 15,
        showTokensCard: true,
        showNftsCard: true,
      })
    ),
    setWalletSettings: jest.fn(() => Promise.resolve()),
  },
}));
jest.mock('@/utils/crypto', () => ({}));
jest.mock('@/utils/crypto/walletEncryption', () => ({
  WalletEncryptionUtil: { validatePin: (pin: string) => /^\d{6}$/.test(pin) },
}));
jest.mock('@/utils/crypto/pinRotation', () => ({}));
jest.mock('@/utils/crypto/deviceCredential', () => ({
  clearDeviceCredential: () => Promise.resolve(),
}));
jest.mock('@/utils/addressBook', () => ({ clearAddressBook: jest.fn() }));
jest.mock('@/stores/transactionHistoryStore', () => ({
  transactionHistoryStore: { clear: jest.fn() },
}));
jest.mock('@/utils/nativeWalletMutation', () => ({
  walletMutations: {
    captureGeneration: () => ({ generation: 0, epoch: 'legacy' }),
    enqueueWalletMutation: jest.fn(),
    enqueuePinChange: jest.fn(),
    enqueueRestore: jest.fn(),
    clear: (clear: () => Promise<void>, after: () => Promise<void>) => clear().then(after),
  },
}));
jest.mock('@/services/dappConnect/DAppConnectService', () => ({
  DAppConnectService: {},
  dappConnectService: {
    reconnectAll: jest.fn(),
    clearAllSessions: () => Promise.resolve(),
    getActiveSessions: () => [],
  },
}));
jest.mock('@/utils/mobileConnect/mobileConnection', () => ({
  disconnectMobile: () => Promise.resolve(),
  hasMobileSession: () => false,
}));
jest.mock('@/router/router', () => ({ ROUTES: { HOME: '/', TRANSFER: '/transfer' } }));
jest.mock('@/config', () => ({
  QRL_PROVIDER: { TEST_NET_V3: {} },
  isAvailableNetwork: (network: string) => network === 'TEST_NET_V3',
}));
jest.mock('@/stores/store', () => ({
  store: {
    qrlStore: {
      activeAccount: { accountAddress: '' },
      setActiveAccount: () => Promise.resolve(),
    },
  },
}));

let receive: (message: NativeMessage) => void = () => undefined;
const requestId = 'ab'.repeat(16);
const address = `Q${'a'.repeat(128)}`;

beforeEach(() => {
  jest.clearAllMocks();
  mockNavigate.mockReset();
  jest.spyOn(console, 'error').mockImplementation(mockError);
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  jest.spyOn(console, 'log').mockImplementation(() => undefined);
  jest.mocked(subscribeToNativeMessages).mockImplementation((listener) => {
    receive = listener;
    return () => undefined;
  });
  window.location.hash = '';
  render(<NativeAppBridge />);
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

it('reports a failed foreground reconnect', async () => {
  const failure = new Error('reconnect failed');
  const reconnect = jest.spyOn(dappConnectService, 'reconnectAll').mockRejectedValue(failure);
  receive({ type: 'APP_STATE', payload: { state: 'active' } });
  await waitFor(() => {
    expect(logToNative).toHaveBeenCalledWith('DApp reconnection failed');
  });
  expect(reconnect).toHaveBeenCalledTimes(1);
  expect(mockError).toHaveBeenCalledWith('[Bridge] Error reconnecting dApp sessions:', failure);
});

it.each<NativeMessage>([
  { type: 'NAVIGATE', payload: { path: '/address-book' } },
  { type: 'QR_RESULT', payload: { address } },
  { type: 'NATIVE_BACK' },
])('reports rejected navigation from $type', async (message) => {
  const failure = new Error('navigation failed');
  mockNavigate.mockImplementation(() => Promise.reject(failure));
  window.location.hash = '#/address-book';
  receive(message);
  await waitFor(() => {
    expect(mockError).toHaveBeenCalledWith('[Bridge] Navigation failed:', failure);
  });
  expect(logToNative).toHaveBeenCalledWith('Navigation failed');
  if (message.type === 'NATIVE_BACK') expect(sendToNative).toHaveBeenCalledWith('BACK_HANDLED');
});

it('keeps synchronous QR navigation and its existing query parameters', () => {
  receive({ type: 'QR_RESULT', payload: { address } });
  expect(mockNavigate).toHaveBeenCalledWith(`/transfer?keep=1&to=${address}`);
});

it('awaits navigation before confirming a wallet clear', async () => {
  let finish: () => void = () => {
    throw new Error('Navigation did not start');
  };
  mockNavigate.mockImplementation(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      })
  );
  receive({ type: 'CLEAR_WALLET', payload: { requestId } });
  await waitFor(() => {
    expect(mockNavigate).toHaveBeenCalledWith('/');
  });
  expect(confirmWalletCleared).not.toHaveBeenCalled();
  finish();
  await waitFor(() => {
    expect(confirmWalletCleared).toHaveBeenCalledWith(requestId, true);
  });
});

it('reports a clear failure when home navigation rejects', async () => {
  mockNavigate.mockImplementation(() => Promise.reject(new Error('navigation failed')));
  receive({ type: 'CLEAR_WALLET', payload: { requestId } });
  await waitFor(() => {
    expect(confirmWalletCleared).toHaveBeenCalledWith(requestId, false, 'Web wallet clear failed');
  });
});

it('reports a PIN verification queue failure and permits a retry', async () => {
  const failure = new Error('lock unavailable');
  const enqueue = jest.spyOn(walletMutations, 'enqueueWalletMutation').mockRejectedValue(failure);
  const message: NativeMessage = { type: 'VERIFY_PIN', payload: { requestId, pin: '123456' } };
  receive(message);
  await waitFor(() => {
    expect(sendPinVerified).toHaveBeenCalledWith(requestId, false, 'Storage error');
  });
  receive(message);
  await waitFor(() => {
    expect(sendPinVerified).toHaveBeenCalledTimes(2);
  });
  expect(enqueue).toHaveBeenCalledTimes(2);
  expect(mockError).toHaveBeenCalledWith('[Bridge] Error verifying PIN:', failure);
});

it('reports a PIN change queue failure with its request ID', async () => {
  const failure = new Error('lock unavailable');
  jest.spyOn(walletMutations, 'enqueuePinChange').mockRejectedValue(failure);
  receive({ type: 'CHANGE_PIN', payload: { requestId, oldPin: '123456', newPin: '654321' } });
  await waitFor(() => {
    expect(sendPinChanged).toHaveBeenCalledWith(
      requestId,
      false,
      undefined,
      'An unexpected error occurred during PIN change.'
    );
  });
  expect(mockError).toHaveBeenCalledWith('[Bridge] Error scheduling PIN change:', failure);
});

it('reports a restore queue failure', async () => {
  const failure = new Error('lock unavailable');
  jest.spyOn(walletMutations, 'enqueueRestore').mockRejectedValue(failure);
  receive({
    type: 'RESTORE_SEED',
    payload: { address, encryptedSeed: 'ciphertext', blockchain: 'TEST_NET_V3' },
  });
  await waitFor(() => {
    expect(mockError).toHaveBeenCalledWith('[Bridge] Error scheduling seed restore:', failure);
  });
  expect(logToNative).toHaveBeenCalledWith('Error restoring seed');
});

it('merges only boolean display preferences and preserves other settings', async () => {
  const write = jest.spyOn(StorageUtil, 'setWalletSettings');
  receive({
    type: 'SET_DISPLAY_PREFS',
    payload: { showTokensCard: false, showNftsCard: 'invalid' },
  });
  await waitFor(() => {
    expect(write).toHaveBeenCalledWith({
      autoLockTimeout: 15,
      showTokensCard: false,
      showNftsCard: true,
    });
  });
});

it('reports a rejected display-preference write', async () => {
  const failure = new Error('storage denied');
  jest.spyOn(StorageUtil, 'setWalletSettings').mockRejectedValue(failure);
  receive({ type: 'SET_DISPLAY_PREFS', payload: { showTokensCard: false } });
  await waitFor(() => {
    expect(mockError).toHaveBeenCalledWith('[Bridge] Error applying SET_DISPLAY_PREFS:', failure);
  });
  expect(logToNative).toHaveBeenCalledWith('Error applying display prefs: storage denied');
});
