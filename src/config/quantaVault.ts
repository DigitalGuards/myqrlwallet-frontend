/** Public application hints. Relay origin metadata is self-reported. */
export interface QuantaVaultConfig {
  readonly origins: readonly string[];
  /** Decimal chain IDs, populated only with verified deployments. */
  readonly multiSendCallOnly: Readonly<Record<string, readonly string[]>>;
}

export const QUANTA_VAULT_CONFIG: QuantaVaultConfig = {
  origins: ["https://quantavault.io"],
  multiSendCallOnly: {},
};

export function isQuantaVaultOrigin(
  url: string,
  config = QUANTA_VAULT_CONFIG,
): boolean {
  try {
    const parsed = new URL(url);
    return (
      !parsed.username &&
      !parsed.password &&
      config.origins.includes(parsed.origin)
    );
  } catch {
    return false;
  }
}
