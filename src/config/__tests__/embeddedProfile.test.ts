import { describe, expect, it } from "@jest/globals";
import {
  EMBEDDED_CHAIN_ID,
  EMBEDDED_CHAIN_ID_DECIMAL,
  EMBEDDED_GENESIS_HASH,
  EMBEDDED_NETWORK_ID,
  EMBEDDED_PROFILE_ENV,
  assertEmbeddedProfile,
} from "@/config/embeddedProfile";
import { findForbiddenEnvKeys } from "@/config/envGuard";
import { v3Deployment } from "@/config/deploymentProfile";

const shippable = {
  isV3Profile: true,
  networkId: EMBEDDED_NETWORK_ID,
  chainId: EMBEDDED_CHAIN_ID,
  genesisHash: EMBEDDED_GENESIS_HASH,
};

describe("committed embedded profile", () => {
  it("selects the v3 profile", () => {
    expect(EMBEDDED_PROFILE_ENV["VITE_WALLET_PROFILE"]).toBe("v3-private");
  });

  it("carries no secret-shaped key and no seed", () => {
    const serialised = Object.keys(EMBEDDED_PROFILE_ENV).join(" ");
    expect(findForbiddenEnvKeys(serialised)).toEqual([]);
    expect(EMBEDDED_PROFILE_ENV["VITE_SEED"]).toBeUndefined();
  });

  it("holds only non-empty VITE_ values", () => {
    for (const [key, value] of Object.entries(EMBEDDED_PROFILE_ENV)) {
      expect(key).toMatch(/^VITE_[A-Z0-9_]+$/);
      expect(typeof value).toBe("string");
      expect(value.length).toBeGreaterThan(0);
    }
  });

  it("points every endpoint at production over https", () => {
    for (const [key, value] of Object.entries(EMBEDDED_PROFILE_ENV)) {
      if (!key.includes("URL")) continue;
      expect(value.startsWith("https://")).toBe(true);
      expect(value).not.toContain("localhost");
      expect(value).not.toContain("127.0.0.1");
    }
  });

  it("agrees with itself on the chain id", () => {
    expect(BigInt(EMBEDDED_CHAIN_ID)).toBe(BigInt(EMBEDDED_CHAIN_ID_DECIMAL));
    expect(EMBEDDED_CHAIN_ID_DECIMAL).toBe(3151909);
  });

  it("is accepted by the real deployment parser as testnet v3", () => {
    // The committed values have to survive the same validation the running
    // wallet applies: credential-free https URLs, a canonical chain id, a
    // 32-byte genesis hash and nonzero 64-byte contract addresses.
    const deployment = v3Deployment(EMBEDDED_PROFILE_ENV);

    expect(deployment.network.id).toBe(EMBEDDED_NETWORK_ID);
    expect(deployment.network.expectedChainId).toBe(EMBEDDED_CHAIN_ID);
    expect(deployment.network.genesisHash).toBe(EMBEDDED_GENESIS_HASH);
    expect(deployment.network.url).toBe(
      "https://qrlwallet.com/api/qrl-rpc/testnet",
    );
    expect(deployment.serverUrl).toBe("https://qrlwallet.com/api");
    expect(deployment.network.explorer).toBe("https://zondscan.com");
    expect(deployment.tokenFactory).toMatch(/^Q[0-9a-fA-F]{128}$/);
    expect(deployment.network.qrns.registry).toMatch(/^Q[0-9a-fA-F]{128}$/);
  });
});

describe("embedded profile assertion", () => {
  it("accepts the profile this build is meant to ship", () => {
    expect(() => assertEmbeddedProfile(shippable)).not.toThrow();
  });

  it("rejects the v2 fallback the device test hit", () => {
    expect(() =>
      assertEmbeddedProfile({
        isV3Profile: false,
        networkId: "",
        chainId: "",
        genesisHash: "",
      }),
    ).toThrow(/default v2 profile/);
  });

  it("rejects a wrong network, chain id or genesis hash", () => {
    expect(() =>
      assertEmbeddedProfile({ ...shippable, networkId: "TEST_NET" }),
    ).toThrow(/expected TEST_NET_V3/);
    expect(() =>
      assertEmbeddedProfile({ ...shippable, chainId: "0x539" }),
    ).toThrow(/expected 0x301825 \(3151909\)/);
    expect(() =>
      assertEmbeddedProfile({ ...shippable, genesisHash: `0x${"0".repeat(64)}` }),
    ).toThrow(/genesis hash/);
  });

  it("compares the genesis hash without regard to case", () => {
    expect(() =>
      assertEmbeddedProfile({
        ...shippable,
        genesisHash: EMBEDDED_GENESIS_HASH.toUpperCase().replace("0X", "0x"),
      }),
    ).not.toThrow();
  });
});
