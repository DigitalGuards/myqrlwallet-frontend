/**
 * Desktop (Electron) seam.
 *
 * When this web wallet runs as the renderer of the MyQRLWallet Electron
 * desktop app, NO secret key material (mnemonic, hex extended seed, ML-DSA-87
 * secret key) may ever be materialised in the renderer. Every key-touching
 * operation routes through the isolated signer in the main process via the
 * `window.qrlWallet` preload bridge.
 *
 * The web build does not inject `window.qrlWallet`, so `isDesktop` is false and
 * every call site falls through to its untouched web path. Nothing in this
 * module runs on the web build.
 *
 * Call sites do `if (isDesktop) return desktopSigner.X(...)` at the top of the
 * existing function; the web path below is left identical.
 */

// ---------------------------------------------------------------------------
// Bridge contract (mirror of window.qrlWallet). All methods async unless noted.
// ---------------------------------------------------------------------------

/** One provisioned desktop wallet (public data only). */
export interface DesktopWalletInfo {
  address: string;
  /** True when this wallet's KEK is held by the OS keychain (macOS). */
  keychainBacked: boolean;
}

/** Signer wallet status snapshot returned by status/unlock/lock/create/import. */
export interface WalletStatus {
  hasWallet: boolean;
  locked: boolean;
  address: string;
  /** Epoch ms when the current unlock session expires, if unlocked. */
  unlockExpiresAt?: number;
  /** True when the seed is held by the OS keychain (macOS). */
  keychainBacked?: boolean;
  /** Every wallet on this device (multi-wallet desktops; absent on older mains). */
  wallets?: DesktopWalletInfo[];
  /** The active wallet's address (multi-wallet desktops; absent on older mains). */
  activeAddress?: string | null;
}

/** Unsigned transaction shape produced by the signer (nonce/gas/chainId filled in main). */
export interface UnsignedTransaction {
  from: string;
  to: string;
  /** Smallest-unit decimal string. */
  value: string;
  data?: string;
  nonce?: number | string;
  gas?: number | string;
  maxFeePerGas?: number | string;
  maxPriorityFeePerGas?: number | string;
  gasPrice?: number | string;
  chainId?: number | string;
  type?: string;
}

export type FeeLevelHint = 'low' | 'medium' | 'high';

/** Result of a signing request handled by the signer (after its trusted confirm modal). */
export interface SignatureResult {
  kind: 'transaction' | 'message' | 'typedData';
  signature: string;
  publicKey?: string;
  signer: string;
  digest?: string;
  /** Present for `kind: 'transaction'`: the broadcast-ready signed payload. */
  rawTransaction?: string;
}

/**
 * dApp-connect provenance attached to a signature request that originated
 * from a connected dApp session. Rendered by the desktop's trusted confirm
 * modal under an explicit "unverified, dApp-supplied" label. The desktop
 * schema is strict (bounded lengths, no control chars, http(s)-or-empty
 * url), so build values with {@link buildDappOrigin} rather than passing
 * raw ORIGINATOR_INFO through.
 */
export interface DAppOriginMeta {
  via: 'dapp';
  name: string;
  url: string;
  channelId: string;
}

/** Discriminated union of signature requests sent to the signer. */
export type SignatureRequest =
  | { kind: 'transaction'; tx: UnsignedTransaction; origin?: DAppOriginMeta }
  | { kind: 'message'; messageHex: string; origin?: DAppOriginMeta }
  | { kind: 'typedData'; payload: unknown; origin?: DAppOriginMeta };

export interface CreateWalletResult {
  status: WalletStatus;
  /** Returned ONCE for backup. The hexSeed is never returned to the renderer. */
  mnemonic: string;
}

/**
 * The preload-exposed bridge. Mirrors the signer contract documented in the
 * desktop app. Kept structural (no class) so the preload's plain object
 * satisfies it.
 */
export interface QrlWalletBridge {
  createWallet(args: { password: string; useKeychain?: boolean }): Promise<CreateWalletResult>;
  /** Import from a mnemonic OR a 51-byte hex extended seed (exactly one). */
  importWallet(args: {
    mnemonic?: string;
    hexSeed?: string;
    password: string;
    useKeychain?: boolean;
  }): Promise<WalletStatus>;
  /** Omit password to attempt an OS keychain unlock (macOS); omit address to
   * unlock the active wallet. */
  unlock(args?: { password?: string; address?: string }): Promise<WalletStatus>;
  lock(): Promise<WalletStatus>;
  /** Destructively remove ONE wallet from this device (the active one when
   * argless): delete its seed + clear its keychain entry. Requires re-import. */
  removeWallet(args?: { address?: string }): Promise<WalletStatus>;
  getStatus(): Promise<WalletStatus>;
  /** Every wallet on this device + the active one. */
  listWallets(): Promise<{ wallets: DesktopWalletInfo[]; active: string | null }>;
  /** Switch the active wallet. When the session belongs to a different account
   * the desktop locks and raises its native unlock window. */
  setActiveWallet(args: { address: string }): Promise<WalletStatus>;
  hasWallet(): Promise<boolean>;
  getBalance(args: { address: string }): Promise<{ address: string; balance: string }>;
  buildTransaction(args: {
    from: string;
    to: string;
    /** Smallest-unit decimal string. */
    value: string;
    feeLevel?: FeeLevelHint;
    data?: string;
  }): Promise<UnsignedTransaction>;
  requestSignature(request: SignatureRequest): Promise<SignatureResult>;
  sendRawTransaction(args: { rawTx: string }): Promise<{ transactionHash: string }>;
  /** Surface the wallet window (taskbar flash / dock bounce, no focus steal)
   * because a dApp request needs the user. Rate-limited by main. Optional:
   * absent on desktop shells that predate dApp-connect. */
  dappRequestAttention?(): Promise<void>;
  onLockStateChanged(cb: (locked: boolean) => void): () => void;
  /** Subscribe to qrlconnect:// URIs arriving via the OS protocol handler.
   * Returns an unsubscribe. Optional: absent on desktop shells that predate
   * dApp-connect. */
  onDAppConnectUri?(cb: (uri: string) => void): () => void;
}

declare global {
  interface Window {
    qrlWallet?: QrlWalletBridge;
  }
}

// ---------------------------------------------------------------------------
// Detection + typed accessor
// ---------------------------------------------------------------------------

/**
 * True only when the renderer is hosted by the Electron desktop app, which
 * injects `window.qrlWallet` from its preload. Computed once at module load:
 * the bridge is present for the lifetime of the renderer or not at all, so a
 * snapshot avoids re-reading `window` on every call site.
 */
export const isDesktop: boolean =
  typeof window !== 'undefined' && Boolean((window as { qrlWallet?: unknown }).qrlWallet);

/**
 * Typed accessor for the bridge. Throws if absent so a desktop-only path that
 * somehow runs without the bridge fails loudly instead of leaking to a web
 * fallback.
 */
export function qrlWallet(): QrlWalletBridge {
  const bridge = typeof window !== 'undefined' ? window.qrlWallet : undefined;
  if (!bridge) {
    throw new Error('desktop: window.qrlWallet bridge is not available');
  }
  return bridge;
}

// ---------------------------------------------------------------------------
// dApp origin sanitiser
// ---------------------------------------------------------------------------

/**
 * Build a desktop-schema-safe origin block from dApp-supplied session info.
 * The desktop main process zod-rejects oversized / control-char / non-http(s)
 * values outright, and a rejected signature request would strand the dApp, so
 * sanitise here: clamp lengths, strip control chars, and map an unusable URL
 * to '' (the confirm modal shows "(not provided)"). Returns undefined only
 * when the channelId itself is unusable, in which case the request proceeds
 * without provenance rather than failing.
 */
export function buildDappOrigin(
  name: string | undefined,
  url: string | undefined,
  channelId: string,
): DAppOriginMeta | undefined {
  if (!/^[0-9a-fA-F-]{1,64}$/.test(channelId)) return undefined;
  const cleanName =
    (name ?? '')
      // eslint-disable-next-line no-control-regex -- stripping control chars is the point
      .replace(/[\u0000-\u001f\u007f]/g, '')
      .trim()
      .slice(0, 64) || 'Unknown dApp';
  let cleanUrl = '';
  if (url) {
    const candidate = url.slice(0, 256);
    try {
      const proto = new URL(candidate).protocol;
      if (proto === 'https:' || proto === 'http:') cleanUrl = candidate;
    } catch {
      /* unusable URL: leave '' */
    }
  }
  return { via: 'dapp', name: cleanName, url: cleanUrl, channelId };
}

// ---------------------------------------------------------------------------
// High-level adapter used by call sites
// ---------------------------------------------------------------------------

/**
 * Thin adapter over the bridge with the high-level helpers the call sites use.
 * Each helper keeps key material in the signer: the renderer only ever sees
 * public addresses, unsigned/signed transaction blobs, and signatures.
 */
export const desktopSigner = {
  /** Provision a fresh wallet. Returns the one-time mnemonic for backup. */
  async createWallet(password: string, useKeychain?: boolean): Promise<CreateWalletResult> {
    return qrlWallet().createWallet({ password, useKeychain });
  },

  /** Import an existing wallet from its mnemonic OR its hex extended seed
   * (exactly one). The signer regenerates the canonical mnemonic from a hex
   * seed, so both routes store an identical encrypted envelope. */
  async importWallet(
    source: { mnemonic?: string; hexSeed?: string },
    password: string,
    useKeychain?: boolean,
  ): Promise<WalletStatus> {
    return qrlWallet().importWallet({ ...source, password, useKeychain });
  },

  /** Unlock the signer session. Omit password for an OS keychain unlock. */
  async unlock(password?: string): Promise<WalletStatus> {
    return qrlWallet().unlock(password === undefined ? undefined : { password });
  },

  /** Lock the signer session (keeps the seed, drops the in-memory session). */
  async lock(): Promise<WalletStatus> {
    return qrlWallet().lock();
  },

  /** Destructively remove ONE wallet from this device (the active one when no
   * address is given). The caller still clears the renderer's local account
   * state for that account. */
  async removeWallet(address?: string): Promise<WalletStatus> {
    return qrlWallet().removeWallet(address === undefined ? undefined : { address });
  },

  /** Every wallet on this device + the active one. */
  async listWallets(): Promise<{ wallets: DesktopWalletInfo[]; active: string | null }> {
    return qrlWallet().listWallets();
  },

  /** Switch the active desktop wallet. When the signer session belongs to a
   * different account the desktop locks and raises its native unlock window
   * (each wallet unlocks with its own password). */
  async setActiveWallet(address: string): Promise<WalletStatus> {
    return qrlWallet().setActiveWallet({ address });
  },

  async getStatus(): Promise<WalletStatus> {
    return qrlWallet().getStatus();
  },

  async hasWallet(): Promise<boolean> {
    return qrlWallet().hasWallet();
  },

  /** Balance in smallest-unit decimal string for the given address. */
  async getBalance(address: string): Promise<string> {
    const result = await qrlWallet().getBalance({ address });
    return result.balance;
  },

  /**
   * Build (in main), confirm + sign (signer modal), then broadcast a
   * transaction. `value`/`data` are pure renderer-side inputs; nonce, gas and
   * chainId are filled by main. Returns the broadcast transaction hash.
   */
  async signAndSendTransaction(
    args: {
      from: string;
      to: string;
      /** Smallest-unit decimal string. */
      value: string;
      data?: string;
      feeLevel?: FeeLevelHint;
    },
    origin?: DAppOriginMeta,
  ): Promise<{ transactionHash: string }> {
    const bridge = qrlWallet();
    const tx = await bridge.buildTransaction({
      from: args.from,
      to: args.to,
      value: args.value,
      data: args.data,
      feeLevel: args.feeLevel,
    });
    const signed = await bridge.requestSignature({ kind: 'transaction', tx, origin });
    if (!signed.rawTransaction) {
      throw new Error('desktop: signer returned no raw transaction');
    }
    return bridge.sendRawTransaction({ rawTx: signed.rawTransaction });
  },

  /**
   * Build + confirm + sign a transaction WITHOUT broadcasting. Used by the
   * dApp `qrl_signTransaction` path which returns the raw tx to the dApp.
   */
  async signTransactionOnly(
    args: {
      from: string;
      to: string;
      /** Smallest-unit decimal string. */
      value: string;
      data?: string;
      feeLevel?: FeeLevelHint;
    },
    origin?: DAppOriginMeta,
  ): Promise<string> {
    const bridge = qrlWallet();
    const tx = await bridge.buildTransaction({
      from: args.from,
      to: args.to,
      value: args.value,
      data: args.data,
      feeLevel: args.feeLevel,
    });
    const signed = await bridge.requestSignature({ kind: 'transaction', tx, origin });
    if (!signed.rawTransaction) {
      throw new Error('desktop: signer returned no raw transaction');
    }
    return signed.rawTransaction;
  },

  /** Sign a hex-encoded message via the signer's trusted modal. */
  async signMessage(messageHex: string, origin?: DAppOriginMeta): Promise<SignatureResult> {
    return qrlWallet().requestSignature({ kind: 'message', messageHex, origin });
  },

  /**
   * Sign typed data. The signer currently THROWS (hasher not yet ported), so
   * callers should surface a clear "not yet supported on desktop" error rather
   * than falling back to an in-renderer signer.
   */
  async signTypedData(payload: unknown, origin?: DAppOriginMeta): Promise<SignatureResult> {
    return qrlWallet().requestSignature({ kind: 'typedData', payload, origin });
  },

  /**
   * Ask main to surface the wallet window because a dApp request is waiting
   * (taskbar flash / dock bounce; rate-limited in main). Optional-called so a
   * renderer paired with an older desktop shell degrades to a no-op.
   */
  async dappRequestAttention(): Promise<void> {
    await qrlWallet().dappRequestAttention?.();
  },

  /**
   * Subscribe to qrlconnect:// URIs from the OS protocol handler. Returns an
   * unsubscribe; a no-op unsubscribe when the shell predates the feature.
   */
  onDAppConnectUri(cb: (uri: string) => void): () => void {
    const bridge = qrlWallet();
    if (typeof bridge.onDAppConnectUri !== 'function') return () => undefined;
    return bridge.onDAppConnectUri(cb);
  },

  /** Broadcast an already-signed raw transaction. */
  async sendRawTransaction(rawTx: string): Promise<{ transactionHash: string }> {
    return qrlWallet().sendRawTransaction({ rawTx });
  },

  /** Subscribe to lock-state changes pushed by main. Returns an unsubscribe fn. */
  onLockStateChanged(cb: (locked: boolean) => void): () => void {
    return qrlWallet().onLockStateChanged(cb);
  },
} as const;
