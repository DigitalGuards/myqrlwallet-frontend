/** @jest-environment jsdom */
import { renderHook } from '@testing-library/react';
import type { PropsWithChildren } from 'react';
import { store, StoreProvider, useStore } from '../store';

jest.mock('../qrlStore', () => jest.fn(() => ({})));
jest.mock('../tokenStore', () => jest.fn(() => ({})));
jest.mock('../nftStore', () => jest.fn(() => ({})));
jest.mock('../dappConnectStore', () => jest.fn(() => ({})));
jest.mock('@/utils/mobileConnect/mobileConnection', () => ({}));
jest.mock('@/utils/storage', () => ({}));

it('uses the singleton when no provider is mounted', () => {
  expect(renderHook(() => useStore()).result.current).toBe(store);
});

it('uses the store supplied by the provider', () => {
  const supplied = {
    qrlStore: store.qrlStore,
    tokenStore: store.tokenStore,
    nftStore: store.nftStore,
    dappConnectStore: store.dappConnectStore,
  };
  const wrapper = ({ children }: PropsWithChildren) => (
    <StoreProvider value={supplied}>{children}</StoreProvider>
  );
  expect(renderHook(() => useStore(), { wrapper }).result.current).toBe(supplied);
});

it.each([null, undefined])('retains the missing-context error for %p', (value) => {
  const error = jest.spyOn(console, 'error').mockImplementation(() => undefined);
  const wrapper = ({ children }: PropsWithChildren) => (
    <StoreProvider value={value}>{children}</StoreProvider>
  );
  try {
    expect(() => renderHook(() => useStore(), { wrapper })).toThrow(
      'useStore must be used within a StoreProvider',
    );
  } finally {
    error.mockRestore();
  }
});
