/** @jest-environment jsdom */

import {
  afterEach,
  beforeEach,
  describe,
  it,
  expect,
  jest,
} from "@jest/globals";
import {
  connectWithProvider,
  dedupeProviders,
  discoverQrlProviders,
  extensionAuthorizesAccount,
  isQrlExtension,
  restoreExtensionProvider,
  type EIP6963ProviderDetail,
} from "@/utils/extension/extensionConnection";
import * as qualification from "../v3Provider";
import {
  firstReadOnly,
  inspectedProviderError,
  opaqueErrorCases,
  providerErrorShapes,
} from "../../__tests__/errorFixtures";

const detail = (rdns: string, uuid: string): EIP6963ProviderDetail => ({
  info: { uuid, rdns, name: rdns, icon: "data:image/svg+xml;base64," },
  provider: { request: () => Promise.resolve(undefined) },
});

const ACCOUNT = `Q${"a".repeat(128)}`;
const OTHER = `Q${"b".repeat(128)}`;
const listeners: (() => void)[] = [];
const announce = (value: unknown) =>
  window.dispatchEvent(
    new CustomEvent("eip6963:announceProvider", { detail: value }),
  );
function installed(value: EIP6963ProviderDetail) {
  const listener = () => {
    announce(value);
  };
  window.addEventListener("eip6963:requestProvider", listener);
  listeners.push(() => {
    window.removeEventListener("eip6963:requestProvider", listener);
  });
  announce(value);
}
function wallet(
  accounts: unknown = [ACCOUNT],
  rdns = "com.qrlwallet.extension",
) {
  const request = jest.fn(
    ({ method }: { method: string }): Promise<unknown> => {
      if (method === "qrl_accounts" || method === "qrl_requestAccounts")
        return Promise.resolve(accounts);
      return Promise.reject(new Error(`Unexpected method: ${method}`));
    },
  );
  return { ...detail(rdns, rdns), provider: { request } };
}

beforeEach(() => {
  jest.useFakeTimers();
});
afterEach(() => {
  for (const remove of listeners.splice(0)) remove();
  jest.clearAllTimers();
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe("isQrlExtension", () => {
  it("accepts the MyQRLWallet Extension fork", () => {
    expect(isQrlExtension({ rdns: "com.qrlwallet.extension" })).toBe(true);
  });

  it("accepts the upstream QRL Web3 Wallet", () => {
    expect(isQrlExtension({ rdns: "theqrl.org" })).toBe(true);
  });

  it("rejects everything else", () => {
    expect(isQrlExtension({ rdns: "io.metamask" })).toBe(false);
    expect(isQrlExtension({ rdns: "com.qrlwallet.connect" })).toBe(false);
    expect(isQrlExtension({ rdns: "" })).toBe(false);
  });
});

describe("dedupeProviders", () => {
  it("collapses repeat announcements from the same extension (fresh uuid per announce)", () => {
    const first = detail("com.qrlwallet.extension", "uuid-1");
    const again = detail("com.qrlwallet.extension", "uuid-2");
    expect(dedupeProviders([first, again])).toEqual([first]);
  });

  it("keeps distinct extensions in announcement order", () => {
    const fork = detail("com.qrlwallet.extension", "a");
    const upstream = detail("theqrl.org", "b");
    expect(dedupeProviders([fork, upstream, fork])).toEqual([fork, upstream]);
  });

  it("handles the empty case", () => {
    expect(dedupeProviders([])).toEqual([]);
  });
});

describe("discovery timing", () => {
  it("requests a fresh announcement after the initial announcement was missed", async () => {
    const extension = wallet();
    installed(extension);
    const result = discoverQrlProviders();
    await jest.advanceTimersByTimeAsync(1000);
    expect(await result).toEqual([extension]);
    expect(jest.getTimerCount()).toBe(0);
  });

  it("collects a delayed extension after a different wallet announces immediately", async () => {
    const upstream = wallet([OTHER], "theqrl.org");
    const extension = wallet();
    installed(upstream);
    const result = discoverQrlProviders();
    setTimeout(() => announce(extension), 700);
    await jest.advanceTimersByTimeAsync(1000);
    expect(await result).toEqual([upstream, extension]);
  });

  it("requests again when the provider listener initializes during discovery", async () => {
    const extension = wallet();
    const result = discoverQrlProviders();
    await jest.advanceTimersByTimeAsync(300);
    const listener = () => {
      announce(extension);
    };
    window.addEventListener("eip6963:requestProvider", listener);
    listeners.push(() => {
      window.removeEventListener("eip6963:requestProvider", listener);
    });
    await jest.advanceTimersByTimeAsync(700);
    expect(await result).toEqual([extension]);
  });

  it("discovers on a later attempt and removes each temporary listener", async () => {
    const remove = jest.spyOn(window, "removeEventListener");
    const first = discoverQrlProviders();
    await jest.advanceTimersByTimeAsync(1000);
    expect(await first).toEqual([]);
    const extension = wallet();
    installed(extension);
    const retry = discoverQrlProviders();
    await jest.advanceTimersByTimeAsync(1000);
    expect(await retry).toEqual([extension]);
    expect(
      remove.mock.calls.filter(
        ([event]) => event === "eip6963:announceProvider",
      ),
    ).toHaveLength(2);
  });

  it("ignores malformed announcements and providers outside the allowlist", async () => {
    const extension = wallet();
    const result = discoverQrlProviders();
    for (const value of [
      null,
      {},
      { info: extension.info },
      { info: extension.info, provider: {} },
      { info: extension.info, provider: { request: true } },
      {
        ...extension,
        info: { ...extension.info, rdns: "com.qrlwallet.connect" },
      },
      { ...extension, info: { ...extension.info, name: 123 } },
    ])
      announce(value);
    window.dispatchEvent(new Event("eip6963:announceProvider"));
    await jest.advanceTimersByTimeAsync(1000);
    expect(await result).toEqual([]);
  });
});

describe("production connection diagnostics", () => {
  it.each(["readable", "expired"] as const)(
    "connects without rereading the %s name getter after discovery",
    async (state) => {
      const extension = wallet();
      const name = jest.fn(() => "Fixture wallet");
      Object.defineProperty(extension.info, "name", { get: name });
      installed(extension);
      const discovering = discoverQrlProviders();
      await jest.advanceTimersByTimeAsync(1000);
      const [discovered] = await discovering;
      expect(discovered).toBe(extension);
      if (!discovered) throw new Error("Expected a discovered extension");
      expect(name).toHaveBeenCalled();
      name.mockClear();
      if (state === "expired") {
        name.mockImplementation(() => {
          throw new Error("Extension name expired after discovery");
        });
      }

      const qualify = jest
        .spyOn(qualification, "qualifyV3Provider")
        .mockResolvedValue(undefined);
      jest.spyOn(console, "log").mockImplementation(() => undefined);
      jest.spyOn(console, "error").mockImplementation(() => undefined);
      const alert = jest
        .spyOn(window, "alert")
        .mockImplementation(() => undefined);
      const setAccount = jest.fn<Parameters<typeof connectWithProvider>[1]>(
        () => Promise.resolve(),
      );
      const setProvider = jest.fn<Parameters<typeof connectWithProvider>[2]>();
      const flag = Object.getOwnPropertyDescriptor(
        globalThis,
        "__QRL_DIAGNOSTICS__",
      );
      Object.defineProperty(globalThis, "__QRL_DIAGNOSTICS__", {
        configurable: true,
        value: false,
      });
      try {
        await expect(
          connectWithProvider(discovered, setAccount, setProvider),
        ).resolves.toEqual([ACCOUNT]);
        expect(qualify).toHaveBeenCalledWith(extension.provider);
        expect(name).not.toHaveBeenCalled();
        expect(extension.provider.request).toHaveBeenCalledTimes(1);
        expect(extension.provider.request).toHaveBeenCalledWith({
          method: "qrl_requestAccounts",
        });
        expect(setProvider).toHaveBeenCalledTimes(1);
        expect(setProvider).toHaveBeenCalledWith(extension.provider);
        expect(setAccount).toHaveBeenCalledTimes(1);
        expect(setAccount).toHaveBeenCalledWith(ACCOUNT, "extension");
        expect(alert).not.toHaveBeenCalled();
      } finally {
        if (flag) {
          Object.defineProperty(globalThis, "__QRL_DIAGNOSTICS__", flag);
        } else {
          Reflect.deleteProperty(globalThis, "__QRL_DIAGNOSTICS__");
        }
      }
    },
  );
});

describe("restoring permission for the selected account", () => {
  // Class: repeated untrusted property reads can change error routing or reject
  // the catch path. Exercise every code branch and supported object shape.
  describe.each(providerErrorShapes)("$name error inspection", (shape) => {
    it("uses the message when code inspection throws", async () => {
      const { value, reads } = inspectedProviderError(
        shape,
        () => {
          throw new Error("Code inaccessible");
        },
        firstReadOnly("failure"),
      );
      jest.spyOn(console, "error").mockImplementation(() => undefined);
      const alert = jest
        .spyOn(window, "alert")
        .mockImplementation(() => undefined);
      const extension = wallet();
      extension.provider.request.mockRejectedValue(value);
      await expect(
        connectWithProvider(
          extension,
          () => Promise.resolve(),
          () => undefined,
        ),
      ).resolves.toBeNull();
      expect(alert).toHaveBeenCalledWith(
        "Error connecting to extension: failure",
      );
      expect(reads).toEqual({ code: 1, message: 1 });
    });

    it.each([
      { code: 4001, alert: "Connection request rejected.", messageReads: 0 },
      { code: -32601, alert: "RPC Error: failure", messageReads: 1 },
      {
        code: -32000,
        alert: "Error connecting to extension: failure",
        messageReads: 1,
      },
      {
        code: undefined,
        alert: "Error connecting to extension: failure",
        messageReads: 1,
      },
      {
        code: "4001",
        alert: "Error connecting to extension: failure",
        messageReads: 1,
      },
    ])(
      "reads code $code and its message once",
      async ({ code, alert: text, messageReads }) => {
        const { value, reads } = inspectedProviderError(
          shape,
          firstReadOnly(code),
          firstReadOnly("failure"),
        );
        jest.spyOn(console, "log").mockImplementation(() => undefined);
        jest.spyOn(console, "error").mockImplementation(() => undefined);
        const alert = jest
          .spyOn(window, "alert")
          .mockImplementation(() => undefined);
        const extension = wallet();
        extension.provider.request.mockRejectedValue(value);
        const setAccount = jest.fn<() => Promise<void>>();
        const order: string[] = [];
        const setProvider = jest.fn((provider: unknown) => {
          expect(provider).toBeNull();
          order.push("clear");
        });
        alert.mockImplementation(() => {
          order.push("alert");
        });
        await expect(
          connectWithProvider(extension, setAccount, setProvider),
        ).resolves.toBeNull();
        expect(setAccount).not.toHaveBeenCalled();
        expect(setProvider).toHaveBeenCalledTimes(1);
        expect(alert).toHaveBeenCalledWith(text);
        expect(order).toEqual(["clear", "alert"]);
        expect(reads).toEqual({ code: 1, message: messageReads });
      },
    );

    it.each([4001, -32601, -32000])(
      "keeps the first code %s when later reads change it",
      async (code) => {
        const { value, reads } = inspectedProviderError(
          shape,
          (read) => (read === 1 ? code : 0),
          (read) => (read === 1 ? "failure" : "changed"),
        );
        jest.spyOn(console, "log").mockImplementation(() => undefined);
        jest.spyOn(console, "error").mockImplementation(() => undefined);
        const alert = jest
          .spyOn(window, "alert")
          .mockImplementation(() => undefined);
        const extension = wallet();
        extension.provider.request.mockRejectedValue(value);
        await expect(
          connectWithProvider(
            extension,
            () => Promise.resolve(),
            () => undefined,
          ),
        ).resolves.toBeNull();
        expect(alert).toHaveBeenCalledWith(
          code === 4001
            ? "Connection request rejected."
            : code === -32601
              ? "RPC Error: failure"
              : "Error connecting to extension: failure",
        );
        expect(reads).toEqual({ code: 1, message: code === 4001 ? 0 : 1 });
      },
    );

    it.each([
      { name: "missing", message: () => undefined },
      { name: "number", message: () => 42 },
      { name: "object", message: () => ({}) },
      {
        name: "throwing",
        message: () => {
          throw new Error("Unreadable message");
        },
      },
    ])(
      "handles rejection without inspecting a $name message",
      async ({ message }) => {
        const { value, reads } = inspectedProviderError(
          shape,
          () => 4001,
          message,
        );
        jest.spyOn(console, "log").mockImplementation(() => undefined);
        jest.spyOn(console, "error").mockImplementation(() => undefined);
        const alert = jest
          .spyOn(window, "alert")
          .mockImplementation(() => undefined);
        const extension = wallet();
        extension.provider.request.mockRejectedValue(value);
        await expect(
          connectWithProvider(
            extension,
            () => Promise.resolve(),
            () => undefined,
          ),
        ).resolves.toBeNull();
        expect(alert).toHaveBeenCalledWith("Connection request rejected.");
        expect(reads).toEqual({ code: 1, message: 0 });
      },
    );
  });

  it.each(["qualification", "request", "activation"])(
    "handles expiring error accessors from %s in order",
    async (stage) => {
      const failure = Object.defineProperty(new Error("failure"), "code", {
        get: jest
          .fn()
          .mockReturnValueOnce(4001)
          .mockImplementation(() => {
            throw new Error("Code expired");
          }),
      });
      jest.spyOn(console, "log").mockImplementation(() => undefined);
      const order: string[] = [];
      const alert = jest.spyOn(window, "alert").mockImplementation(() => {
        order.push("alert");
      });
      const extension = wallet();
      jest.spyOn(qualification, "qualifyV3Provider").mockImplementation(() => {
        order.push("qualification");
        return stage === "qualification"
          ? Promise.reject(failure)
          : Promise.resolve();
      });
      extension.provider.request.mockImplementation(() => {
        order.push("request");
        return stage === "request"
          ? Promise.reject(failure)
          : Promise.resolve([ACCOUNT]);
      });
      const setAccount = () => {
        order.push("activation");
        return Promise.reject(failure);
      };
      const setProvider = (provider: unknown) => {
        order.push(provider === null ? "clear" : "provider");
      };
      await expect(
        connectWithProvider(extension, setAccount, setProvider),
      ).resolves.toBeNull();
      expect(alert).toHaveBeenCalledWith("Connection request rejected.");
      expect(order).toEqual(
        stage === "qualification"
          ? ["qualification", "clear", "alert"]
          : stage === "request"
            ? ["qualification", "request", "clear", "alert"]
            : [
                "qualification",
                "request",
                "provider",
                "activation",
                "clear",
                "alert",
              ],
      );
    },
  );

  it.each([-32601, -32000])(
    "contains unsafe Error.message coercion for code %s",
    async (code) => {
      const failure = Object.defineProperties(new Error(), {
        code: { value: code },
        message: {
          get: () => ({
            toString() {
              throw new Error("Coercion failed");
            },
          }),
        },
      });
      jest.spyOn(console, "error").mockImplementation(() => undefined);
      const alert = jest
        .spyOn(window, "alert")
        .mockImplementation(() => undefined);
      const extension = wallet();
      extension.provider.request.mockRejectedValue(failure);
      await expect(
        connectWithProvider(
          extension,
          () => Promise.resolve(),
          () => undefined,
        ),
      ).resolves.toBeNull();
      expect(alert).toHaveBeenCalledWith(
        code === -32601
          ? "RPC Error: Unknown error"
          : "Error connecting to extension: Unknown error",
      );
    },
  );

  it.each(opaqueErrorCases)(
    "completes connection failure handling for $name",
    async ({ create, message }) => {
      jest.spyOn(console, "log").mockImplementation(() => undefined);
      jest.spyOn(console, "error").mockImplementation(() => undefined);
      const alert = jest
        .spyOn(window, "alert")
        .mockImplementation(() => undefined);
      const extension = wallet();
      extension.provider.request.mockRejectedValue(create());
      const setAccount = jest.fn<() => Promise<void>>();
      const setProvider = jest.fn();
      await expect(
        connectWithProvider(extension, setAccount, setProvider),
      ).resolves.toBeNull();
      expect(setAccount).not.toHaveBeenCalled();
      expect(setProvider).toHaveBeenCalledWith(null);
      expect(alert).toHaveBeenCalledWith(
        `Error connecting to extension: ${message}`,
      );
    },
  );

  it("selects the unique authorized wallet and keeps a non-first stored account", async () => {
    const upstream = wallet([OTHER], "theqrl.org");
    const extension = wallet([OTHER, ACCOUNT]);
    installed(upstream);
    installed(extension);
    const result = restoreExtensionProvider(ACCOUNT);
    await jest.advanceTimersByTimeAsync(1000);
    expect(await result).toBe(extension.provider);
    expect(extension.provider.request).toHaveBeenCalledWith({
      method: "qrl_accounts",
    });
    expect(extension.provider.request).not.toHaveBeenCalledWith({
      method: "qrl_requestAccounts",
    });
  });

  it("matches address casing and preserves an explicitly selected live provider", async () => {
    const current = wallet([`Q${"A".repeat(128)}`]);
    installed(wallet());
    expect(await restoreExtensionProvider(ACCOUNT, current.provider)).toBe(
      current.provider,
    );
    expect(jest.getTimerCount()).toBe(0);
  });

  it.each(
    [
      [],
      [OTHER],
      [ACCOUNT, 4],
      [ACCOUNT, "bad"],
      ACCOUNT,
      null,
      { accounts: [ACCOUNT] },
    ].map((accounts) => ({ accounts })),
  )(
    "fails closed for revoked, mismatched or malformed permission: $accounts",
    async ({ accounts }) => {
      const extension = wallet(accounts);
      installed(extension);
      const result = restoreExtensionProvider(ACCOUNT);
      await jest.advanceTimersByTimeAsync(1000);
      expect(await result).toBeNull();
      expect(extension.provider.request).not.toHaveBeenCalledWith({
        method: "qrl_requestAccounts",
      });
    },
  );

  it("rejects ambiguous matching wallets", async () => {
    installed(wallet());
    installed(wallet([ACCOUNT], "theqrl.org"));
    const result = expect(restoreExtensionProvider(ACCOUNT)).rejects.toThrow(
      "Multiple extensions",
    );
    await jest.advanceTimersByTimeAsync(1000);
    await result;
  });

  it("can reacquire a replacement provider after a cached handle stops responding", async () => {
    const current = wallet();
    current.provider.request.mockRejectedValue(
      new Error("Provider disconnected"),
    );
    const replacement = wallet();
    installed(replacement);
    const result = restoreExtensionProvider(ACCOUNT, current.provider);
    await jest.advanceTimersByTimeAsync(1000);
    expect(await result).toBe(replacement.provider);
  });

  it("bounds a silent permission check and clears its timer", async () => {
    const result = extensionAuthorizesAccount(
      { request: () => new Promise(() => undefined) },
      ACCOUNT,
    );
    await jest.advanceTimersByTimeAsync(10000);
    expect(await result).toBe(false);
    expect(jest.getTimerCount()).toBe(0);
  });

  it("rejects malformed account responses during explicit connection", async () => {
    jest.spyOn(console, "log").mockImplementation(() => undefined);
    jest.spyOn(console, "error").mockImplementation(() => undefined);
    jest.spyOn(window, "alert").mockImplementation(() => undefined);
    const setAccount = jest.fn<() => Promise<void>>();
    const setProvider = jest.fn();
    expect(
      await connectWithProvider(
        wallet([ACCOUNT, 123]),
        setAccount,
        setProvider,
      ),
    ).toBeNull();
    expect(setAccount).not.toHaveBeenCalled();
    expect(setProvider).toHaveBeenCalledWith(null);
  });
});
