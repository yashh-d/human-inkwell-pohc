/**
 * Whether the MiniKit JS bridge is present (World App sets this during MiniKit.install()).
 * Same truth as MiniKit.isInstalled() from @worldcoin/minikit-js, but without calling the SDK
 * helper — that helper console.error()s on every false check outside World App.
 */
export function isMiniKitBridgeAvailable(): boolean {
  if (typeof window === 'undefined') return false;
  return Boolean((window as unknown as { MiniKit?: unknown }).MiniKit);
}
