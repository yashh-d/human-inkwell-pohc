/**
 * CreatorSignIn — step 1 of creating a creator account.
 *
 * One tap: Google sign-in via Privy (an embedded wallet is minted silently), or
 * World App walletAuth when inside World App. No seed phrase, no World ID wall —
 * proof-of-human is an optional badge added later. See useCreatorAuth.
 */
import { useCreatorAuth } from '../hooks/useCreatorAuth';

export default function CreatorSignIn({
  heading = 'Create your creator account',
  sub = 'Sign in and claim your profile in two quick steps. No wallet or seed phrase — we handle that for you.',
}: { heading?: string; sub?: string }) {
  const { signIn, signingIn, isInWorldApp, error } = useCreatorAuth();

  return (
    <div style={S.card}>
      <div style={S.step}>Step 1 of 2</div>
      <h2 style={S.h}>{heading}</h2>
      <p style={S.sub}>{sub}</p>
      <button style={S.btn} onClick={signIn} disabled={signingIn}>
        {signingIn ? 'Opening sign-in…' : isInWorldApp ? 'Continue with World App' : 'Continue with Google'}
      </button>
      {error && <p style={S.err}>{error}</p>}
      <p style={S.fine}>Then you’ll pick a @handle — that’s your public profile. That’s it.</p>
    </div>
  );
}

const S: Record<string, React.CSSProperties> = {
  card: { border: '1px solid var(--hi-border, #e6e9ee)', borderRadius: 14, padding: '24px 22px', background: 'var(--hi-surface, #fff)', maxWidth: 420, margin: '8px auto', textAlign: 'center' },
  step: { fontSize: 10.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.6, color: 'var(--hi-cyan-ink, #075985)' },
  h: { fontSize: 20, fontWeight: 750, margin: '8px 0 6px', color: 'var(--hi-text, #0a0a0a)' },
  sub: { fontSize: 13.5, color: 'var(--hi-text-muted, #64748b)', margin: '0 0 18px', lineHeight: 1.55 },
  btn: { width: '100%', color: '#fff', background: 'var(--hi-cyan, #00b4d8)', fontSize: 15, fontWeight: 700, border: 'none', borderRadius: 10, padding: '12px 16px', cursor: 'pointer' },
  err: { fontSize: 12.5, color: '#b91c1c', margin: '10px 0 0' },
  fine: { fontSize: 11.5, color: 'var(--hi-text-muted, #64748b)', margin: '14px 0 0', lineHeight: 1.5 },
};
