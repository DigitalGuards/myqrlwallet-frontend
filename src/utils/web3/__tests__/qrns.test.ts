import {
  normalizeQrnsName,
  normalizeQrnsRecipientName,
  qrnsFunctionSelector,
  qrnsNamehashHex,
} from "@/utils/crypto/qrnsNamehash";
import { normalizeQrlAddress, QRL_ZERO_ADDRESS } from "@/utils/web3/address";
import {
  parseQrnsNetworkConfig,
  resolveQrnsRecipient,
  type QrnsNetworkConfig,
  type QrnsRpcProvider,
} from "@/utils/web3/qrns";

function canonicalAddress(hexCharacter: string): string {
  const address = normalizeQrlAddress(`Q${hexCharacter.repeat(128)}`);
  if (!address) throw new Error("Test address must be valid");
  return address;
}

const REGISTRY = canonicalAddress("1");
const RESOLVER = canonicalAddress("2");
const RECIPIENT = canonicalAddress("3");

const CONFIG: QrnsNetworkConfig = {
  blockchain: "TEST_NET",
  networkName: "QRL Test",
  rpcUrl: "http://127.0.0.1:18545",
  expectedChainId: "0x539",
  registry: REGISTRY,
};

function encodedAddress(address: string): string {
  return `0x${address.slice(1).toLowerCase()}`;
}

function mockProvider(
  request: QrnsRpcProvider["request"],
  identity = "test-provider",
): QrnsRpcProvider {
  return { identity, request };
}

describe("native QRVM64 QRNS resolution", () => {
  it("matches the QNS normalization and namehash vector", () => {
    expect(normalizeQrnsName("ALICE.QRL")).toBe("alice.qrl");
    expect(normalizeQrnsRecipientName("ALICE.QRL")).toBe("alice.qrl");
    expect(qrnsNamehashHex("alice.qrl")).toBe(
      "0xefe3586aa9a851831a32d38044822af21cc5380e38f05cdc0dd562b4cfada103",
    );
  });

  it.each(["alice", "alice.eth"])(
    "rejects a recipient without the canonical .qrl suffix before RPC: %s",
    async (name) => {
      const request: jest.MockedFunction<QrnsRpcProvider["request"]> =
        jest.fn();

      await expect(
        resolveQrnsRecipient(name, CONFIG, mockProvider(request)),
      ).rejects.toThrow("must end in .qrl");
      expect(request).not.toHaveBeenCalled();
    },
  );

  it("requires a complete canonical nonzero deployment record", () => {
    expect(
      parseQrnsNetworkConfig({
        ...CONFIG,
        expectedChainId: "",
        registry: "",
      }),
    ).toEqual({
      available: false,
      reason: "QRNS is not configured for QRL Test.",
    });
    expect(
      parseQrnsNetworkConfig({ ...CONFIG, expectedChainId: "0x0539" }),
    ).toMatchObject({ available: false });
    expect(
      parseQrnsNetworkConfig({ ...CONFIG, registry: QRL_ZERO_ADDRESS }),
    ).toMatchObject({ available: false });
    expect(parseQrnsNetworkConfig(CONFIG)).toEqual({
      available: true,
      config: CONFIG,
    });
  });

  it("verifies the chain and registry code before two native calls", async () => {
    const request: jest.MockedFunction<QrnsRpcProvider["request"]> = jest.fn(
      async ({ method }) => {
        if (method === "qrl_chainId") return "0x539";
        if (method === "qrl_getCode") return "0x01";
        const qrlCallCount = request.mock.calls.filter(
          ([args]) => args.method === "qrl_call",
        ).length;
        return qrlCallCount === 1
          ? encodedAddress(RESOLVER)
          : encodedAddress(RECIPIENT);
      },
    );
    const result = await resolveQrnsRecipient(
      "Alice.QRL",
      CONFIG,
      mockProvider(request),
    );

    expect(result).toEqual({
      normalizedName: "alice.qrl",
      address: RECIPIENT,
    });
    expect(request.mock.calls.map(([args]) => args.method)).toEqual([
      "qrl_chainId",
      "qrl_getCode",
      "qrl_call",
      "qrl_call",
    ]);
    const registryCall = request.mock.calls[2]?.[0];
    const resolverCall = request.mock.calls[3]?.[0];
    expect(registryCall?.params?.[0]).toMatchObject({
      to: REGISTRY,
      data: expect.stringMatching(
        new RegExp(`^${qrnsFunctionSelector("resolver(bytes32)")}\\w{128}$`),
      ),
    });
    expect(resolverCall?.params?.[0]).toMatchObject({
      to: RESOLVER,
      data: expect.stringMatching(
        new RegExp(`^${qrnsFunctionSelector("addr(bytes32)")}\\w{128}$`),
      ),
    });
  });

  it("fails closed when the RPC is on the wrong chain", async () => {
    const provider = mockProvider(async ({ method }) =>
      method === "qrl_chainId" ? "0x1" : "0x01",
    );
    await expect(
      resolveQrnsRecipient("alice.qrl", CONFIG, provider),
    ).rejects.toMatchObject({ code: "network-mismatch" });
  });

  it.each(["0x", "0x00", "malformed"])(
    "fails closed when the registry has no usable code: %s",
    async (code) => {
      const provider = mockProvider(async ({ method }) =>
        method === "qrl_chainId" ? "0x539" : code,
      );
      await expect(
        resolveQrnsRecipient("alice.qrl", CONFIG, provider),
      ).rejects.toMatchObject({ code: "registry-no-code" });
    },
  );

  it("returns no recipient for zero resolver and zero native records", async () => {
    const zeroResolver = mockProvider(async ({ method }) => {
      if (method === "qrl_chainId") return "0x539";
      if (method === "qrl_getCode") return "0x01";
      return `0x${"0".repeat(128)}`;
    });
    await expect(
      resolveQrnsRecipient("alice.qrl", CONFIG, zeroResolver),
    ).resolves.toEqual({ normalizedName: "alice.qrl", address: null });

    let callCount = 0;
    const zeroAddress = mockProvider(async ({ method }) => {
      if (method === "qrl_chainId") return "0x539";
      if (method === "qrl_getCode") return "0x01";
      callCount += 1;
      return callCount === 1
        ? encodedAddress(RESOLVER)
        : `0x${"0".repeat(128)}`;
    });
    await expect(
      resolveQrnsRecipient("alice.qrl", CONFIG, zeroAddress),
    ).resolves.toEqual({ normalizedName: "alice.qrl", address: null });
  });

  it.each(["0x12", `0x${"g".repeat(128)}`, 7])(
    "rejects malformed address returns: %s",
    async (result) => {
      const provider = mockProvider(async ({ method }) => {
        if (method === "qrl_chainId") return "0x539";
        if (method === "qrl_getCode") return "0x01";
        return result;
      });
      await expect(
        resolveQrnsRecipient("alice.qrl", CONFIG, provider),
      ).rejects.toThrow("malformed 64-byte address");
    },
  );

  it("treats ABI return hex casing as wire encoding", async () => {
    let callCount = 0;
    const provider = mockProvider(async ({ method }) => {
      if (method === "qrl_chainId") return "0x539";
      if (method === "qrl_getCode") return "0x01";
      callCount += 1;
      return callCount === 1
        ? encodedAddress(RESOLVER)
        : `0x${"Aa".repeat(64)}`;
    });

    await expect(
      resolveQrnsRecipient("alice.qrl", CONFIG, provider),
    ).resolves.toEqual({
      normalizedName: "alice.qrl",
      address: canonicalAddress("a"),
    });
  });

  it("surfaces RPC failures without producing an address", async () => {
    const provider = mockProvider(async () => {
      throw new Error("offline");
    });
    await expect(
      resolveQrnsRecipient("alice.qrl", CONFIG, provider),
    ).rejects.toThrow("offline");
  });
});
