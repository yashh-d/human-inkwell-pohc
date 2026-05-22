/**
 * Persist the MiniKit (World App) wallet address across sessions.
 *
 * MiniKit.user.walletAddress is only populated after walletAuth() — and we
 * stripped the explicit login button (commit d3958e0). So once we *do* learn
 * the user's address (either from walletAuth or as the `from` of a successful
 * sendTransaction), we cache it locally and use it as the fallback identity
 * everywhere we'd otherwise need to prompt again.
 *
 * Source of truth is still onchain; this is just so My Content can render
 * immediately on cold load without a second auth tap.
 */
const KEY = 'hi-minikit-wallet-v1';

function storage(): Storage | null {
  try {
    if (typeof window === 'undefined') return null;
    return window.localStorage;
  } catch {
    return null;
  }
}

function isValidAddress(addr: unknown): addr is string {
  return typeof addr === 'string' && /^0x[0-9a-fA-F]{40}$/.test(addr);
}

export function rememberMiniKitWallet(addr: string | null | undefined): void {
  if (!isValidAddress(addr)) return;
  const s = storage();
  if (!s) return;
  try {
    s.setItem(KEY, addr.toLowerCase());
  } catch {
    /* private mode */
  }
}

export function getRememberedMiniKitWallet(): string | null {
  const s = storage();
  if (!s) return null;
  try {
    const v = s.getItem(KEY);
    return isValidAddress(v) ? v.toLowerCase() : null;
  } catch {
    return null;
  }
}

export function forgetMiniKitWallet(): void {
  const s = storage();
  if (!s) return;
  try {
    s.removeItem(KEY);
  } catch {
    /* ignore */
  }
}
