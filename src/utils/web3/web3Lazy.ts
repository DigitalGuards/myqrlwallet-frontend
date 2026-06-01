// Lazy singleton for @theqrl/web3 — ensures the 600 KB post-quantum crypto
// bundle is not in the initial parse graph and only loads once at runtime.
type QrlWeb3Module = typeof import("@theqrl/web3");

let _mod: QrlWeb3Module | null = null;

export async function getQrlWeb3(): Promise<QrlWeb3Module> {
  if (!_mod) _mod = await import("@theqrl/web3");
  return _mod;
}
