import { useMemo } from "react";
import { getNetworkConfig } from "@/config/networks";
import {
  createQrnsHttpProvider,
  parseQrnsNetworkConfig,
  type QrnsNetworkRecord,
} from "@/utils/web3/qrns";
import {
  useQrnsRecipient,
  type UseQrnsRecipientResult,
} from "@/hooks/useQrnsRecipient";

interface UseNetworkQrnsRecipientOptions {
  input: string;
  blockchain: string;
  accountAddress: string;
}

/** Bind recipient resolution to the wallet's selected, explicitly configured network. */
export function useNetworkQrnsRecipient({
  input,
  blockchain,
  accountAddress,
}: UseNetworkQrnsRecipientOptions): UseQrnsRecipientResult {
  const network = getNetworkConfig(blockchain);
  const record = useMemo<QrnsNetworkRecord | null>(
    () =>
      network
        ? {
            blockchain,
            networkName: network.name,
            rpcUrl: network.url,
            expectedChainId: network.qrns.expectedChainId,
            registry: network.qrns.registry,
            ...("genesisHash" in network
              ? { genesisHash: network.genesisHash }
              : {}),
          }
        : null,
    [blockchain, network],
  );
  const configuration = useMemo(() => parseQrnsNetworkConfig(record), [record]);
  const provider = useMemo(
    () =>
      configuration.available
        ? createQrnsHttpProvider(configuration.config.rpcUrl)
        : null,
    [configuration],
  );

  return useQrnsRecipient({
    input,
    blockchain,
    accountAddress,
    configuration,
    provider,
  });
}
