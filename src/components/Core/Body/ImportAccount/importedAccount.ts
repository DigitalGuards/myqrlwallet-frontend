import type { WalletData } from "@/utils/crypto";

export type ImportedAccount = Pick<WalletData, "address"> &
  Partial<Pick<WalletData, "mnemonic" | "hexSeed">>;
