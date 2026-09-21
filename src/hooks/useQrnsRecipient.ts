import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  QrnsNameError,
  normalizeQrnsRecipientName,
} from "@/utils/crypto/qrnsNamehash";
import { QRL_ADDRESS_LENGTH, normalizeQrlAddress } from "@/utils/web3/address";
import {
  QrnsUnavailableError,
  resolveQrnsRecipient,
  type QrnsNetworkConfiguration,
  type QrnsRpcProvider,
} from "@/utils/web3/qrns";

const QRNS_INPUT_DEBOUNCE_MS = 250;

export type QrnsRecipientStatus =
  | "idle"
  | "pending"
  | "success"
  | "error"
  | "unavailable";

export interface QrnsRecipientState {
  status: QrnsRecipientStatus;
  source: "direct" | "qrns" | null;
  input: string;
  normalizedName: string | null;
  address: string | null;
  message: string | null;
  bindingKey: string;
}

export interface RecipientSubmission {
  readonly input: string;
  readonly address: string;
  readonly bindingKey: string;
}

export interface UseQrnsRecipientOptions {
  input: string;
  blockchain: string;
  accountAddress: string;
  configuration: QrnsNetworkConfiguration;
  provider: QrnsRpcProvider | null;
}

export interface UseQrnsRecipientResult extends QrnsRecipientState {
  captureSubmission(input: string): RecipientSubmission | null;
  revalidateSubmission(submission: RecipientSubmission): string | null;
}

const EMPTY_STATE: QrnsRecipientState = {
  status: "idle",
  source: null,
  input: "",
  normalizedName: null,
  address: null,
  message: null,
  bindingKey: "",
};

function makeBindingKey(
  input: string,
  blockchain: string,
  accountAddress: string,
  configuration: QrnsNetworkConfiguration,
  provider: QrnsRpcProvider | null,
): string {
  const networkBinding = configuration.available
    ? [
        configuration.config.expectedChainId,
        configuration.config.genesisHash ?? "",
        configuration.config.registry,
        configuration.config.rpcUrl,
      ]
    : ["unavailable", configuration.reason];
  return JSON.stringify([
    input.trim(),
    blockchain,
    accountAddress,
    ...networkBinding,
    provider?.identity ?? "no-provider",
  ]);
}

function looksLikeMalformedQrlAddress(input: string): boolean {
  return input.length === QRL_ADDRESS_LENGTH && /^[Qq]/.test(input);
}

type RecipientPreflight =
  | { kind: "empty" }
  | { kind: "direct"; address: string }
  | { kind: "error"; message: string }
  | { kind: "unavailable"; normalizedName: string; message: string }
  | { kind: "resolve"; normalizedName: string; networkName: string };

function prepareRecipient(
  input: string,
  configuration: QrnsNetworkConfiguration,
  provider: QrnsRpcProvider | null,
): RecipientPreflight {
  if (!input) return { kind: "empty" };

  const directAddress = normalizeQrlAddress(input);
  if (directAddress) return { kind: "direct", address: directAddress };
  if (looksLikeMalformedQrlAddress(input)) {
    return {
      kind: "error",
      message: "Recipient is not a valid QRL address.",
    };
  }

  let normalizedName: string;
  try {
    normalizedName = normalizeQrnsRecipientName(input);
  } catch (error) {
    return {
      kind: "error",
      message:
        error instanceof QrnsNameError
          ? error.message
          : "Recipient is not a supported QNS name.",
    };
  }

  if (!configuration.available || !provider) {
    return {
      kind: "unavailable",
      normalizedName,
      message: configuration.available
        ? "QRNS has no provider for the selected network."
        : configuration.reason,
    };
  }
  return {
    kind: "resolve",
    normalizedName,
    networkName: configuration.config.networkName,
  };
}

/**
 * Resolve one recipient while binding every async result to the current input,
 * account, selected network, deployment record, and provider identity.
 */
export function useQrnsRecipient({
  input,
  blockchain,
  accountAddress,
  configuration,
  provider,
}: UseQrnsRecipientOptions): UseQrnsRecipientResult {
  const [asyncState, setAsyncState] = useState<QrnsRecipientState | null>(null);
  const requestSequence = useRef(0);
  const trimmedInput = input.trim();
  const currentBindingKey = useMemo(
    () =>
      makeBindingKey(
        trimmedInput,
        blockchain,
        accountAddress,
        configuration,
        provider,
      ),
    [accountAddress, blockchain, configuration, provider, trimmedInput],
  );
  const preflight = useMemo(
    () => prepareRecipient(trimmedInput, configuration, provider),
    [configuration, provider, trimmedInput],
  );

  useEffect(() => {
    const sequence = ++requestSequence.current;
    if (preflight.kind !== "resolve" || !configuration.available || !provider) {
      return () => {
        requestSequence.current += 1;
      };
    }

    const resolveTimer = setTimeout(() => {
      void resolveQrnsRecipient(
        preflight.normalizedName,
        configuration.config,
        provider,
      )
        .then((result) => {
          if (requestSequence.current !== sequence) return;
          if (!result.address) {
            setAsyncState({
              status: "error",
              source: "qrns",
              input: trimmedInput,
              normalizedName: result.normalizedName,
              address: null,
              message: `No native QRL address is set for ${result.normalizedName}.`,
              bindingKey: currentBindingKey,
            });
            return;
          }
          setAsyncState({
            status: "success",
            source: "qrns",
            input: trimmedInput,
            normalizedName: result.normalizedName,
            address: result.address,
            message: `${result.normalizedName} resolved successfully.`,
            bindingKey: currentBindingKey,
          });
        })
        .catch((error: unknown) => {
          if (requestSequence.current !== sequence) return;
          setAsyncState({
            status:
              error instanceof QrnsUnavailableError ? "unavailable" : "error",
            source: "qrns",
            input: trimmedInput,
            normalizedName: preflight.normalizedName,
            address: null,
            message:
              error instanceof Error
                ? error.message
                : `Unable to resolve ${preflight.normalizedName}.`,
            bindingKey: currentBindingKey,
          });
        });
    }, QRNS_INPUT_DEBOUNCE_MS);

    return () => {
      clearTimeout(resolveTimer);
      requestSequence.current += 1;
    };
  }, [configuration, currentBindingKey, preflight, provider, trimmedInput]);

  const visibleState = useMemo<QrnsRecipientState>(() => {
    switch (preflight.kind) {
      case "empty":
        return EMPTY_STATE;
      case "direct":
        return {
          status: "success",
          source: "direct",
          input: trimmedInput,
          normalizedName: null,
          address: preflight.address,
          message: "Recipient address verified.",
          bindingKey: currentBindingKey,
        };
      case "error":
        return {
          status: "error",
          source: null,
          input: trimmedInput,
          normalizedName: null,
          address: null,
          message: preflight.message,
          bindingKey: currentBindingKey,
        };
      case "unavailable":
        return {
          status: "unavailable",
          source: "qrns",
          input: trimmedInput,
          normalizedName: preflight.normalizedName,
          address: null,
          message: preflight.message,
          bindingKey: currentBindingKey,
        };
      case "resolve":
        return asyncState?.bindingKey === currentBindingKey
          ? asyncState
          : {
              status: "pending",
              source: "qrns",
              input: trimmedInput,
              normalizedName: preflight.normalizedName,
              address: null,
              message: `Resolving ${preflight.normalizedName} on ${preflight.networkName}.`,
              bindingKey: currentBindingKey,
            };
    }
  }, [asyncState, currentBindingKey, preflight, trimmedInput]);

  const currentBindingKeyRef = useRef(currentBindingKey);
  const stateRef = useRef(visibleState);

  useLayoutEffect(() => {
    currentBindingKeyRef.current = currentBindingKey;
    stateRef.current = visibleState;
  }, [currentBindingKey, visibleState]);

  const captureSubmission = useCallback(
    (submissionInput: string): RecipientSubmission | null => {
      const expectedBinding = makeBindingKey(
        submissionInput.trim(),
        blockchain,
        accountAddress,
        configuration,
        provider,
      );
      const currentState = stateRef.current;
      if (
        currentState.status !== "success" ||
        !currentState.address ||
        currentState.bindingKey !== expectedBinding ||
        expectedBinding !== currentBindingKeyRef.current
      ) {
        return null;
      }
      return {
        input: submissionInput.trim(),
        address: currentState.address,
        bindingKey: expectedBinding,
      };
    },
    [accountAddress, blockchain, configuration, provider],
  );

  const revalidateSubmission = useCallback(
    (submission: RecipientSubmission): string | null => {
      const currentState = stateRef.current;
      if (
        submission.bindingKey !== currentBindingKeyRef.current ||
        currentState.bindingKey !== submission.bindingKey ||
        currentState.status !== "success" ||
        currentState.address !== submission.address
      ) {
        return null;
      }
      return submission.address;
    },
    [],
  );

  return {
    ...visibleState,
    captureSubmission,
    revalidateSubmission,
  };
}
