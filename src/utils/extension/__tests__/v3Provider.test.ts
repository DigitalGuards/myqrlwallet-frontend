/** @jest-environment jsdom */
jest.mock("@/config/runtimeProfile", () => ({ IS_V3_PROFILE: true }));
jest.mock("@/config", () => ({
  QRL_PROVIDER: {
    TEST_NET_V3: {
      expectedChainId: "0x301825",
      genesisHash: `0x${"ab".repeat(32)}`,
    },
  },
}));

import { assertQualifiedV3Provider, qualifyV3Provider } from "../v3Provider";
import { connectWithProvider } from "../extensionConnection";
import type { ExtensionProvider } from "@/stores/qrlStore";

const HASH = `0x${"ab".repeat(32)}`;
const ACCOUNT = `Q${"1".repeat(128)}`;
function fixture() {
  const capabilities = {
    addressScheme: "qip55-64",
    chainId: "0x301825",
    genesisHash: HASH,
  };
  const request = jest.fn(
    async ({ method }: { method: string }): Promise<unknown> => {
      if (method === "qrl_walletCapabilities") return capabilities;
      if (method === "qrl_chainId") return "0x301825";
      if (method === "qrl_getBlockByNumber")
        return { number: "0x0", hash: HASH };
      if (method === "qrl_requestAccounts") return [ACCOUNT];
      throw new Error("Unexpected RPC method");
    },
  );
  const provider: ExtensionProvider = { request };
  return { capabilities, request, provider };
}

beforeEach(() => {
  jest.spyOn(console, "log").mockImplementation(() => undefined);
  jest.spyOn(console, "error").mockImplementation(() => undefined);
  jest.spyOn(window, "alert").mockImplementation(() => undefined);
});
afterEach(() => jest.restoreAllMocks());

it("requires capabilities plus chain and genesis verification before account access", async () => {
  const { provider, request } = fixture();
  const order: string[] = [];
  const account = jest.fn(async () => {
    order.push("account");
  });
  const setProvider = jest.fn(() => {
    assertQualifiedV3Provider(provider);
    order.push("provider");
  });
  expect(() => assertQualifiedV3Provider(provider)).toThrow(
    "not yet qualified",
  );
  expect(
    await connectWithProvider(
      {
        info: {
          uuid: "x",
          rdns: "com.qrlwallet.extension",
          name: "test",
          icon: "",
        },
        provider,
      },
      account,
      setProvider,
    ),
  ).toEqual([ACCOUNT]);
  expect(order).toEqual(["provider", "account"]);
  expect(request.mock.calls.map(([args]) => args.method)).toEqual([
    "qrl_walletCapabilities",
    "qrl_chainId",
    "qrl_getBlockByNumber",
    "qrl_requestAccounts",
  ]);
});

it.each(["addressScheme", "chainId", "genesisHash"])(
  "rejects a mismatched %s capability",
  async (field) => {
    const { provider, capabilities, request } = fixture();
    Object.assign(capabilities, { [field]: "wrong" });
    await expect(qualifyV3Provider(provider)).rejects.toThrow(
      "not yet qualified",
    );
    expect(() => assertQualifiedV3Provider(provider)).toThrow();
    expect(request).toHaveBeenCalledTimes(1);
  },
);

it("revokes qualification if the extension changes networks", async () => {
  const { provider, request } = fixture();
  await qualifyV3Provider(provider);
  expect(() => assertQualifiedV3Provider(provider)).not.toThrow();
  request.mockImplementation(async ({ method }) =>
    method === "qrl_walletCapabilities"
      ? { addressScheme: "qip55-64", chainId: "0x301825", genesisHash: HASH }
      : "0x539",
  );
  await expect(qualifyV3Provider(provider)).rejects.toThrow(
    "chain identity mismatch",
  );
  expect(() => assertQualifiedV3Provider(provider)).toThrow();
});

it("rejects legacy addresses even after network qualification", async () => {
  const { provider, request } = fixture();
  const original = request.getMockImplementation();
  if (!original) throw new Error("Missing fixture request implementation");
  request.mockImplementation(async (args) =>
    args.method === "qrl_requestAccounts"
      ? [`Q${"1".repeat(40)}`]
      : original(args),
  );
  const account = jest.fn();
  const setProvider = jest.fn();
  expect(
    await connectWithProvider(
      {
        info: {
          uuid: "x",
          rdns: "com.qrlwallet.extension",
          name: "test",
          icon: "",
        },
        provider,
      },
      account,
      setProvider,
    ),
  ).toBeNull();
  expect(account).not.toHaveBeenCalled();
  expect(setProvider).toHaveBeenCalledWith(null);
});

it("times out an unresponsive extension before account access", async () => {
  jest.useFakeTimers();
  try {
    const provider: ExtensionProvider = {
      request: () => new Promise(() => undefined),
    };
    const result = expect(qualifyV3Provider(provider)).rejects.toThrow(
      "timed out",
    );
    await jest.advanceTimersByTimeAsync(10000);
    await result;
    expect(() => assertQualifiedV3Provider(provider)).toThrow();
  } finally {
    jest.useRealTimers();
  }
});

it.each([false, true])(
  "shares concurrent qualification and revokes failed checks: %s",
  async (fail) => {
    const { provider, request, capabilities } = fixture();
    await qualifyV3Provider(provider);
    request.mockClear();
    let release: (value: unknown) => void = () => {
      throw new Error("Missing resolver");
    };
    const capabilitiesRead = new Promise<unknown>((resolve) => {
      release = resolve;
    });
    const original = request.getMockImplementation();
    if (!original) throw new Error("Missing fixture implementation");
    request.mockImplementation(async (args) =>
      args.method === "qrl_walletCapabilities"
        ? capabilitiesRead
        : original(args),
    );
    const first = qualifyV3Provider(provider);
    const second = qualifyV3Provider(provider);
    expect(() => assertQualifiedV3Provider(provider)).not.toThrow();
    release(fail ? {} : capabilities);
    const results = await Promise.allSettled([first, second]);
    expect(results.map((result) => result.status)).toEqual(
      fail ? ["rejected", "rejected"] : ["fulfilled", "fulfilled"],
    );
    expect(
      request.mock.calls.filter(
        ([args]) => args.method === "qrl_walletCapabilities",
      ),
    ).toHaveLength(1);
    if (fail) expect(() => assertQualifiedV3Provider(provider)).toThrow();
    else expect(() => assertQualifiedV3Provider(provider)).not.toThrow();
  },
);
