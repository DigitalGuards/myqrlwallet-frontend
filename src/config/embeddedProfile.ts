/**
 * The production configuration the embedded build ships with.
 *
 * The embedded document is bundled into the mobile app, so it has to carry its
 * own settings. The hosted builds get theirs from a `.env` on the deployment
 * host; a build from a clean checkout has none and silently falls back to the
 * default v2 profile. That is not a theoretical gap: a device test of the first
 * embedded document ran the v2 profile, so `SEED_STORED` arrived with
 * blockchain `TEST_NET` while the native app requires `TEST_NET_V3`, and PIN
 * setup failed.
 *
 * Every value here is public configuration that the live qrlwallet.com bundle
 * already publishes to every visitor. Nothing secret belongs in this file, and
 * nothing secret can be added to it by accident: `VITE_SEED` and the rest of
 * the forbidden key names are rejected by `envExposureGuard` in the base Vite
 * config, and `assertEmbeddedProfile` below rejects anything that is not the
 * v3 profile this build is meant to ship.
 *
 * Only `config/vite.config.embedded.ts` consumes this. The web and desktop
 * builds keep reading their deployment's environment.
 */

/** Chain identity of the QRL 2.0 v3 testnet this build is pinned to. */
export const EMBEDDED_CHAIN_ID = "0x301825";
export const EMBEDDED_CHAIN_ID_DECIMAL = 3151909;
export const EMBEDDED_GENESIS_HASH =
  "0xd15407991193e6c23b733dc6bf9c628deaff8f9b6e252aa0d60030952b3e3ea4";
export const EMBEDDED_NETWORK_ID = "TEST_NET_V3";

/**
 * Exactly the `VITE_*` values the embedded build is compiled with.
 *
 * Keys the application never reads are deliberately absent: an unread value
 * inlined into a shipped document is published for no reason. The DEVELOPMENT
 * endpoints are absent for the same reason, since this is always a production
 * build.
 */
export const EMBEDDED_PROFILE_ENV: Readonly<Record<string, string>> = {
  // v3 profile selection. Without this the wallet runs the default v2 profile.
  VITE_WALLET_PROFILE: "v3-private",

  // v3 deployment, all seven keys `v3Deployment()` requires.
  VITE_V3_CHAIN_ID: EMBEDDED_CHAIN_ID,
  VITE_V3_GENESIS_HASH: EMBEDDED_GENESIS_HASH,
  VITE_V3_RPC_URL: "https://qrlwallet.com/api/qrl-rpc/testnet",
  VITE_V3_SERVER_URL: "https://qrlwallet.com/api",
  VITE_V3_EXPLORER_URL: "https://zondscan.com",
  VITE_V3_FACTORY_ADDRESS:
    "Q519E79f891876b39C96d77877405cc09C169B2fBDf75c7B3Ee25631da62f8706AA64591d201ba64022f79edA2C3F75A75d7136acBa9c5CeC0324c93BBb3a2acf",
  VITE_V3_QNS_REGISTRY:
    "Qcfc5f3242cE7d413F308D4181fd45D441d535298d78fd2d26833c2650408f636B46590dc10D23221480eFac958705Ba6C266eEB16B5aeafA64202715Adc84424",

  // Non-v3 production endpoints. The v3 profile overrides these at runtime, so
  // they are the fallbacks a profile misconfiguration would land on, and they
  // still have to point at production rather than localhost.
  VITE_RPC_URL_PRODUCTION: "https://qrlwallet.com/api/qrl-rpc",
  VITE_SERVER_URL_PRODUCTION: "https://qrlwallet.com/api",
  VITE_EXPLORER_URL_PRODUCTION: "https://zondscan.com",
};

/**
 * What the embedded document must resolve to once built.
 *
 * The profile reaches the bundle through the build environment, so a mistake
 * there shows up as a wallet quietly running the wrong network rather than as
 * a build error. This turns it into a build error.
 */
export interface EmbeddedResolvedProfile {
  readonly isV3Profile: boolean;
  readonly networkId: string;
  readonly chainId: string;
  readonly genesisHash: string;
}

export function assertEmbeddedProfile(resolved: EmbeddedResolvedProfile): void {
  const problems: string[] = [];
  if (!resolved.isV3Profile) {
    problems.push(
      "the wallet profile is not v3-private, so the document would run the default v2 profile",
    );
  }
  if (resolved.networkId !== EMBEDDED_NETWORK_ID) {
    problems.push(
      `the selected network is ${resolved.networkId}, expected ${EMBEDDED_NETWORK_ID}`,
    );
  }
  if (resolved.chainId !== EMBEDDED_CHAIN_ID) {
    problems.push(
      `the chain id is ${resolved.chainId}, expected ${EMBEDDED_CHAIN_ID} (${EMBEDDED_CHAIN_ID_DECIMAL})`,
    );
  }
  if (resolved.genesisHash.toLowerCase() !== EMBEDDED_GENESIS_HASH) {
    problems.push(
      `the genesis hash is ${resolved.genesisHash}, expected ${EMBEDDED_GENESIS_HASH}`,
    );
  }
  if (problems.length > 0) {
    throw new Error(
      `embedded build: wrong wallet profile:\n  ${problems.join("\n  ")}`,
    );
  }
}
