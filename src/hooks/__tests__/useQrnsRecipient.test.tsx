/** @jest-environment jsdom */

import { act, render, waitFor } from "@testing-library/react";
import { RecipientResolutionStatus } from "@/components/Core/RecipientResolutionStatus";
import {
  useQrnsRecipient,
  type UseQrnsRecipientResult,
} from "@/hooks/useQrnsRecipient";
import { qrnsNamehashHex } from "@/utils/crypto/qrnsNamehash";
import { normalizeQrlAddress } from "@/utils/web3/address";
import type {
  QrnsNetworkConfig,
  QrnsNetworkConfiguration,
  QrnsRpcProvider,
} from "@/utils/web3/qrns";

function canonicalAddress(hexCharacter: string): string {
  const address = normalizeQrlAddress(`Q${hexCharacter.repeat(128)}`);
  if (!address) throw new Error("Test address must be valid");
  return address;
}

const REGISTRY = canonicalAddress("1");
const RESOLVER_A = canonicalAddress("2");
const RESOLVER_B = canonicalAddress("3");
const RECIPIENT_A = canonicalAddress("4");
const RECIPIENT_B = canonicalAddress("5");
const ACCOUNT = canonicalAddress("6");

const CONFIG: QrnsNetworkConfig = {
  blockchain: "TEST_NET",
  networkName: "QRL Test",
  rpcUrl: "http://127.0.0.1:18545",
  expectedChainId: "0x539",
  registry: REGISTRY,
};

const CONFIGURATION: QrnsNetworkConfiguration = {
  available: true,
  config: CONFIG,
};

const UNAVAILABLE: QrnsNetworkConfiguration = {
  available: false,
  reason: "QRNS is not configured for QRL Test.",
};

function encodedAddress(address: string): string {
  return `0x${address.slice(1).toLowerCase()}`;
}

function deferred<T>() {
  let resolvePromise: ((value: T) => void) | null = null;
  const promise = new Promise<T>((resolve) => {
    resolvePromise = resolve;
  });
  return {
    promise,
    resolve(value: T) {
      if (!resolvePromise) throw new Error("Deferred promise is unavailable");
      resolvePromise(value);
    },
  };
}

interface HarnessProps {
  input: string;
  blockchain?: string;
  accountAddress?: string;
  configuration?: QrnsNetworkConfiguration;
  provider: QrnsRpcProvider | null;
  onResult(result: UseQrnsRecipientResult): void;
}

function Harness({
  input,
  blockchain = "TEST_NET",
  accountAddress = ACCOUNT,
  configuration = CONFIGURATION,
  provider,
  onResult,
}: HarnessProps) {
  const result = useQrnsRecipient({
    input,
    blockchain,
    accountAddress,
    configuration,
    provider,
  });
  onResult(result);
  return <RecipientResolutionStatus resolution={result} />;
}

describe("useQrnsRecipient", () => {
  it("shows QRL address wording for a malformed recipient without any RPC request", () => {
    const request: jest.MockedFunction<QrnsRpcProvider["request"]> = jest.fn();
    const latest = { current: null as UseQrnsRecipientResult | null };
    const invalid = `q${RECIPIENT_A.slice(1)}`;
    const view = render(
      <Harness
        input={invalid}
        provider={{ identity: "invalid-recipient", request }}
        onResult={(result) => {
          latest.current = result;
        }}
      />,
    );
    expect(view.getByRole("alert").textContent).toBe(
      "Recipient is not a valid QRL address.",
    );
    expect(latest.current?.captureSubmission(invalid)).toBeNull();
    expect(request).not.toHaveBeenCalled();
  });

  it("accepts a direct QIP-55 address without any RPC request", async () => {
    const request: jest.MockedFunction<QrnsRpcProvider["request"]> = jest.fn();
    const provider: QrnsRpcProvider = { identity: "direct-test", request };
    const latest = { current: null as UseQrnsRecipientResult | null };
    const view = render(
      <Harness
        input={RECIPIENT_A}
        provider={provider}
        onResult={(result) => {
          latest.current = result;
        }}
      />,
    );

    await waitFor(() => expect(view.getByRole("status")).toBeTruthy());
    expect(view.getByLabelText(`QRL address ${RECIPIENT_A}`)).toBeTruthy();
    expect(request).not.toHaveBeenCalled();
    expect(latest.current?.captureSubmission(RECIPIENT_A)?.address).toBe(
      RECIPIENT_A,
    );
  });

  it("shows QRNS unavailable while direct addresses remain independent", async () => {
    const latest = { current: null as UseQrnsRecipientResult | null };
    const view = render(
      <Harness
        input="alice.qrl"
        configuration={UNAVAILABLE}
        provider={null}
        onResult={(result) => {
          latest.current = result;
        }}
      />,
    );

    await waitFor(() =>
      expect(view.getByText(UNAVAILABLE.reason)).toBeTruthy(),
    );
    expect(latest.current?.status).toBe("unavailable");
    expect(latest.current?.address).toBeNull();
  });

  it.each(["alice", "alice.eth"])(
    "rejects a recipient without the canonical .qrl suffix before RPC: %s",
    async (input) => {
      const request: jest.MockedFunction<QrnsRpcProvider["request"]> =
        jest.fn();
      const provider: QrnsRpcProvider = { identity: "suffix-test", request };
      const latest = { current: null as UseQrnsRecipientResult | null };
      const view = render(
        <Harness
          input={input}
          provider={provider}
          onResult={(result) => {
            latest.current = result;
          }}
        />,
      );

      await waitFor(() =>
        expect(
          view.getByText("QRNS recipient names must end in .qrl."),
        ).toBeTruthy(),
      );
      expect(latest.current?.status).toBe("error");
      expect(latest.current?.address).toBeNull();
      expect(request).not.toHaveBeenCalled();
    },
  );

  it("normalizes and resolves a recipient with the canonical .qrl suffix", async () => {
    const request: jest.MockedFunction<QrnsRpcProvider["request"]> = jest.fn(
      async ({ method, params }) => {
        if (method === "qrl_chainId") return "0x539";
        if (method === "qrl_getCode") return "0x01";
        const call = params?.[0];
        if (typeof call !== "object" || call === null || !("to" in call)) {
          throw new Error("Missing qrl_call request");
        }
        return call.to === REGISTRY
          ? encodedAddress(RESOLVER_A)
          : encodedAddress(RECIPIENT_A);
      },
    );
    const provider: QrnsRpcProvider = { identity: "valid-suffix", request };
    const latest = { current: null as UseQrnsRecipientResult | null };
    const view = render(
      <Harness
        input="Alice.QRL"
        provider={provider}
        onResult={(result) => {
          latest.current = result;
        }}
      />,
    );

    await waitFor(() =>
      expect(view.getByLabelText(`QRL address ${RECIPIENT_A}`)).toBeTruthy(),
    );
    expect(latest.current?.normalizedName).toBe("alice.qrl");
    expect(latest.current?.captureSubmission("Alice.QRL")?.address).toBe(
      RECIPIENT_A,
    );
  });

  it("discards a late name result after the input changes", async () => {
    const aliceResolver = deferred<unknown>();
    const aliceNode = qrnsNamehashHex("alice.qrl").slice(2);
    const bobNode = qrnsNamehashHex("bob.qrl").slice(2);
    const request: jest.MockedFunction<QrnsRpcProvider["request"]> = jest.fn(
      async ({ method, params }) => {
        if (method === "qrl_chainId") return "0x539";
        if (method === "qrl_getCode") return "0x01";
        const call = params?.[0];
        if (typeof call !== "object" || call === null) {
          throw new Error("Missing qrl_call request");
        }
        const to = "to" in call ? call.to : null;
        const data = "data" in call ? call.data : null;
        if (to === REGISTRY && typeof data === "string") {
          if (data.includes(aliceNode)) return aliceResolver.promise;
          if (data.includes(bobNode)) return encodedAddress(RESOLVER_B);
        }
        if (to === RESOLVER_A) return encodedAddress(RECIPIENT_A);
        if (to === RESOLVER_B) return encodedAddress(RECIPIENT_B);
        throw new Error("Unexpected QRNS call");
      },
    );
    const provider: QrnsRpcProvider = { identity: "stale-input", request };
    const latest = { current: null as UseQrnsRecipientResult | null };
    const onResult = (result: UseQrnsRecipientResult) => {
      latest.current = result;
    };
    const view = render(
      <Harness input="alice.qrl" provider={provider} onResult={onResult} />,
    );

    await waitFor(() =>
      expect(
        request.mock.calls.some(
          ([args]) =>
            args.method === "qrl_call" &&
            JSON.stringify(args.params).includes(aliceNode),
        ),
      ).toBe(true),
    );
    view.rerender(
      <Harness input="bob.qrl" provider={provider} onResult={onResult} />,
    );
    await waitFor(() =>
      expect(view.getByLabelText(`QRL address ${RECIPIENT_B}`)).toBeTruthy(),
    );
    const bobSubmission = latest.current?.captureSubmission("bob.qrl");
    expect(bobSubmission?.address).toBe(RECIPIENT_B);

    await act(async () => {
      aliceResolver.resolve(encodedAddress(RESOLVER_A));
      await Promise.resolve();
    });
    expect(view.queryByText(RECIPIENT_A)).toBeNull();
    expect(view.getByLabelText(`QRL address ${RECIPIENT_B}`)).toBeTruthy();
  });

  it("invalidates a captured recipient immediately after network or account change", async () => {
    const request: jest.MockedFunction<QrnsRpcProvider["request"]> = jest.fn();
    const provider: QrnsRpcProvider = { identity: "binding-test", request };
    const latest = { current: null as UseQrnsRecipientResult | null };
    const onResult = (result: UseQrnsRecipientResult) => {
      latest.current = result;
    };
    const view = render(
      <Harness input={RECIPIENT_A} provider={provider} onResult={onResult} />,
    );
    await waitFor(() => expect(latest.current?.status).toBe("success"));
    const captured = latest.current?.captureSubmission(RECIPIENT_A);
    if (!captured) throw new Error("Expected a captured recipient");

    view.rerender(
      <Harness
        input={RECIPIENT_A}
        blockchain="MAIN_NET"
        accountAddress={canonicalAddress("7")}
        provider={provider}
        onResult={onResult}
      />,
    );
    expect(latest.current?.revalidateSubmission(captured)).toBeNull();
    expect(request).not.toHaveBeenCalled();
  });

  it("discards a late result from the previously selected network", async () => {
    const oldResolver = deferred<unknown>();
    const oldRequest: jest.MockedFunction<QrnsRpcProvider["request"]> = jest.fn(
      async ({ method, params }) => {
        if (method === "qrl_chainId") return "0x539";
        if (method === "qrl_getCode") return "0x01";
        const call = params?.[0];
        if (typeof call !== "object" || call === null || !("to" in call)) {
          throw new Error("Missing old-network qrl_call request");
        }
        if (call.to === REGISTRY) return oldResolver.promise;
        if (call.to === RESOLVER_A) return encodedAddress(RECIPIENT_A);
        throw new Error("Unexpected old-network QRNS call");
      },
    );
    const oldProvider: QrnsRpcProvider = {
      identity: "old-network",
      request: oldRequest,
    };
    const newRegistry = canonicalAddress("8");
    const newConfiguration: QrnsNetworkConfiguration = {
      available: true,
      config: {
        ...CONFIG,
        blockchain: "MAIN_NET",
        networkName: "QRL Main",
        expectedChainId: "0x2",
        registry: newRegistry,
      },
    };
    const newProvider: QrnsRpcProvider = {
      identity: "new-network",
      request: async ({ method, params }) => {
        if (method === "qrl_chainId") return "0x2";
        if (method === "qrl_getCode") return "0x01";
        const call = params?.[0];
        if (typeof call !== "object" || call === null || !("to" in call)) {
          throw new Error("Missing new-network qrl_call request");
        }
        return call.to === newRegistry
          ? encodedAddress(RESOLVER_B)
          : encodedAddress(RECIPIENT_B);
      },
    };
    const latest = { current: null as UseQrnsRecipientResult | null };
    const onResult = (result: UseQrnsRecipientResult) => {
      latest.current = result;
    };
    const view = render(
      <Harness input="alice.qrl" provider={oldProvider} onResult={onResult} />,
    );
    await waitFor(() =>
      expect(
        oldRequest.mock.calls.some(([args]) => args.method === "qrl_call"),
      ).toBe(true),
    );

    view.rerender(
      <Harness
        input="alice.qrl"
        blockchain="MAIN_NET"
        configuration={newConfiguration}
        provider={newProvider}
        onResult={onResult}
      />,
    );
    await waitFor(() =>
      expect(view.getByLabelText(`QRL address ${RECIPIENT_B}`)).toBeTruthy(),
    );

    await act(async () => {
      oldResolver.resolve(encodedAddress(RESOLVER_A));
      await Promise.resolve();
    });
    expect(view.queryByText(RECIPIENT_A)).toBeNull();
    expect(view.getByLabelText(`QRL address ${RECIPIENT_B}`)).toBeTruthy();
    expect(latest.current?.status).toBe("success");
  });

  it("renders RPC failures as an error and exposes no submission address", async () => {
    const provider: QrnsRpcProvider = {
      identity: "offline-test",
      request: async () => {
        throw new Error("RPC offline");
      },
    };
    const latest = { current: null as UseQrnsRecipientResult | null };
    const view = render(
      <Harness
        input="alice.qrl"
        provider={provider}
        onResult={(result) => {
          latest.current = result;
        }}
      />,
    );

    await waitFor(() => expect(view.getByRole("alert")).toBeTruthy());
    expect(view.getByText("RPC offline")).toBeTruthy();
    expect(latest.current?.captureSubmission("alice.qrl")).toBeNull();
  });
});
