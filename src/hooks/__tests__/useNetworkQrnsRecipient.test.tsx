/** @jest-environment jsdom */

import { renderHook } from "@testing-library/react";
import { getNetworkConfig } from "@/config/networks";
import type { NetworkConfig } from "@/config/deploymentProfile";
import { createQrnsHttpProvider } from "@/utils/web3/qrns";
import { useQrnsRecipient } from "../useQrnsRecipient";
import type { UseQrnsRecipientResult } from "../useQrnsRecipient";
import { useNetworkQrnsRecipient } from "../useNetworkQrnsRecipient";

jest.mock("@/config/networks", () => ({ getNetworkConfig: jest.fn() }));
jest.mock("../useQrnsRecipient", () => ({ useQrnsRecipient: jest.fn() }));
jest.mock("@/utils/web3/qrns", () => ({
  ...jest.requireActual<typeof import("@/utils/web3/qrns")>(
    "@/utils/web3/qrns",
  ),
  createQrnsHttpProvider: jest.fn(),
}));

const network: NetworkConfig = {
  id: "TEST_NET_V3",
  name: "QRL Testnet v3",
  url: "https://wallet.example/rpc",
  explorer: "https://explorer.example",
  qrns: { expectedChainId: "0x301825", registry: `Q${"1".repeat(128)}` },
};
const options = {
  input: "alice.qrl",
  blockchain: network.id,
  accountAddress: `Q${"2".repeat(128)}`,
};
const resolution: UseQrnsRecipientResult = {
  status: "idle",
  source: null,
  input: "",
  normalizedName: null,
  address: null,
  message: null,
  bindingKey: "",
  captureSubmission: () => null,
  revalidateSubmission: () => null,
};

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(useQrnsRecipient).mockReturnValue(resolution);
});

it.each([undefined, `0x${"ab".repeat(32)}`])(
  "binds recipient resolution to the configured network with genesis %s",
  (genesisHash) => {
    const selected = {
      ...network,
      ...(genesisHash === undefined ? {} : { genesisHash }),
    };
    const provider = { identity: "configured-network", request: jest.fn() };
    jest.mocked(getNetworkConfig).mockReturnValue(selected);
    jest.mocked(createQrnsHttpProvider).mockReturnValue(provider);
    const { result, rerender } = renderHook(() =>
      useNetworkQrnsRecipient(options),
    );

    expect(getNetworkConfig).toHaveBeenCalledWith(network.id);
    expect(createQrnsHttpProvider).toHaveBeenCalledWith(network.url);
    expect(useQrnsRecipient).toHaveBeenCalledWith({
      ...options,
      provider,
      configuration: {
        available: true,
        config: {
          blockchain: network.id,
          networkName: network.name,
          rpcUrl: network.url,
          ...network.qrns,
          ...(genesisHash === undefined ? {} : { genesisHash }),
        },
      },
    });
    expect(result.current).toBe(resolution);
    rerender();
    expect(createQrnsHttpProvider).toHaveBeenCalledTimes(1);

    jest.mocked(getNetworkConfig).mockReturnValue(undefined);
    rerender();
    expect(useQrnsRecipient).toHaveBeenLastCalledWith({
      ...options,
      configuration: {
        available: false,
        reason: "QRNS is unavailable until a wallet network is selected.",
      },
      provider: null,
    });
  },
);

it("keeps name resolution unavailable when the network lookup has no match", () => {
  jest.mocked(getNetworkConfig).mockReturnValue(undefined);
  const unavailable = { ...options, blockchain: "UNKNOWN" };
  renderHook(() => useNetworkQrnsRecipient(unavailable));
  expect(createQrnsHttpProvider).not.toHaveBeenCalled();
  expect(useQrnsRecipient).toHaveBeenCalledWith({
    ...unavailable,
    configuration: {
      available: false,
      reason: "QRNS is unavailable until a wallet network is selected.",
    },
    provider: null,
  });
});
