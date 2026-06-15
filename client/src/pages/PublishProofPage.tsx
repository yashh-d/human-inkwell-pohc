import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useLoginWithOAuth, useWallets } from '@privy-io/react-auth';
import { ethers } from 'ethers';
import { blockchainService } from '../blockchain';
import { pushLedgerIndexAfterOnChainSuccess } from '../ledgerSupabase';
import { useViewerAddress } from '../hooks/useViewerAddress';
import { rememberMiniKitWallet } from '../utils/miniKitWallet';

/**
 * /publish — entry point for the Human Ink Chrome extension.
 *
 * The extension captures keystroke biometrics (incl. Google Docs) on the user's
 * machine, computes the SAME hashes this app uses, and opens:
 *   https://humanink.xyz/publish#proof=<base64url-JSON>
 *
 * Here we: (1) parse that payload, (2) auto-provision the author's account — one
 * tap "Continue with Google" creates a Privy embedded wallet (config:
 * createOnLogin 'users-without-wallets'), no seed phrase, no extension wallet —
 * and (3) run the existing gasless sign + submit flow with the SUPPLIED hashes.
 * No keystroke re-capture. The proof rides the URL fragment (never hits a
 * server) and is mirrored to sessionStorage so it survives the OAuth round-trip.
 */

type ExtensionProof = {
  v: number;
  source: string;
  contentHash: string;
  humanSignatureHash: string;
  keystrokeCount: number;
  typingSpeed: number;
  context?: string;
  docTitle?: string | null;
  url?: string | null;
  email?: string | null;
};

const PROOF_KEY = 'humanink_pending_proof';

function b64urlDecode(s: string): string {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/');
  const pad = b64.length % 4 ? '='.repeat(4 - (b64.length % 4)) : '';
  return decodeURIComponent(escape(atob(b64 + pad)));
}

/** Read the proof from the URL fragment, falling back to the sessionStorage
 *  mirror (so a Privy OAuth redirect that remounts the app doesn't lose it). */
function loadProof(): { proof?: ExtensionProof; error?: string } {
  const m = (window.location.hash || '').match(/proof=([^&]+)/);
  if (m) {
    try {
      const obj = JSON.parse(b64urlDecode(m[1])) as ExtensionProof;
      if (!obj.contentHash || !obj.humanSignatureHash) {
        return { error: 'Proof payload is missing its hashes.' };
      }
      try { sessionStorage.setItem(PROOF_KEY, JSON.stringify(obj)); } catch { /* private mode */ }
      return { proof: obj };
    } catch (e) {
      return { error: `Could not read the proof payload: ${e instanceof Error ? e.message : String(e)}` };
    }
  }
  try {
    const saved = sessionStorage.getItem(PROOF_KEY);
    if (saved) return { proof: JSON.parse(saved) as ExtensionProof };
  } catch { /* ignore */ }
  return { error: 'No proof to publish. Open this page from the Human Ink extension.' };
}

const short = (h?: string | null) => (h ? `${h.slice(0, 10)}…${h.slice(-8)}` : '—');

type SubmitState =
  | { phase: 'idle' }
  | { phase: 'submitting' }
  | { phase: 'success'; result: any }
  | { phase: 'error'; message: string };

export default function PublishProofPage() {
  const { proof, error: parseError } = useMemo(loadProof, []);
  const identity = useViewerAddress();
  const { wallets } = useWallets();
  const [submit, setSubmit] = useState<SubmitState>({ phase: 'idle' });
  const [authError, setAuthError] = useState<string | null>(null);
  // Intent to publish as soon as the wallet is ready (set when the user taps
  // before sign-in completes). Survives the popup OAuth flow in-memory.
  const [pendingPublish, setPendingPublish] = useState(false);

  const { initOAuth } = useLoginWithOAuth({
    onError: (err) => {
      setPendingPublish(false);
      setAuthError(typeof err === 'string' ? err : 'Google sign-in failed.');
    },
  });

  // Clear the proof from the address bar once parsed (kept in sessionStorage).
  useEffect(() => {
    if (proof && window.location.hash) {
      try { window.history.replaceState(null, '', window.location.pathname); } catch { /* no-op */ }
    }
  }, [proof]);

  const doPublish = useCallback(async () => {
    if (!proof || identity.status !== 'ready') return;
    setSubmit({ phase: 'submitting' });
    try {
      const submissionData = {
        contentHash: proof.contentHash,
        humanSignatureHash: proof.humanSignatureHash,
        keystrokeCount: proof.keystrokeCount,
        typingSpeed: proof.typingSpeed,
        worldIdNullifier: undefined,
      };

      // Browser (Privy) needs an explicit embedded-wallet signer; inside World
      // App, MiniKit signs and submitContent picks the wallet up itself.
      let privySigner: ethers.Signer | undefined;
      let privyAddress: string | undefined;
      if (identity.source === 'privy' && wallets && wallets.length > 0) {
        const wallet = wallets.find((w) => w.walletClientType === 'privy') || wallets[0];
        privyAddress = wallet.address;
        const ethereumProvider = await wallet.getEthereumProvider();
        const provider = new ethers.BrowserProvider(ethereumProvider as any);
        privySigner = await provider.getSigner();
      }

      const result = await blockchainService.submitContent(submissionData, {
        onProgress: () => {},
        privySigner,
        privyAddress,
      });

      if (result.success && (result.transactionHash || typeof result.entryId === 'number')) {
        const authorAddress = result.walletAddress || identity.address;
        if (result.walletAddress) rememberMiniKitWallet(result.walletAddress);
        try {
          await pushLedgerIndexAfterOnChainSuccess(result, {
            contentHash: submissionData.contentHash,
            humanSignatureHash: submissionData.humanSignatureHash,
            keystrokeCount: submissionData.keystrokeCount,
            typingSpeed: submissionData.typingSpeed,
            isVerified: false,
            authorAddress,
          });
        } catch (e) {
          console.warn('Ledger indexing failed (on-chain write still succeeded):', e);
        }
        try { sessionStorage.removeItem(PROOF_KEY); } catch { /* ignore */ }
        setSubmit({ phase: 'success', result });
      } else {
        setSubmit({ phase: 'error', message: result.error || 'Could not confirm the on-chain write.' });
      }
    } catch (e) {
      setSubmit({ phase: 'error', message: e instanceof Error ? e.message : String(e) });
    }
  }, [proof, identity, wallets]);

  // Once the wallet is ready and the user has signalled intent, publish.
  useEffect(() => {
    if (pendingPublish && identity.status === 'ready' && submit.phase === 'idle') {
      setPendingPublish(false);
      doPublish();
    }
  }, [pendingPublish, identity.status, submit.phase, doPublish]);

  // Single primary action: provision the account if needed, then publish.
  const handlePrimary = useCallback(() => {
    setAuthError(null);
    if (identity.status === 'ready') {
      doPublish();
    } else if (identity.status === 'needs-auth') {
      setPendingPublish(true);
      identity.authenticate(); // World App walletAuth
    } else {
      // Browser: one-tap Google → Privy auto-creates the embedded wallet.
      setPendingPublish(true);
      try {
        initOAuth({ provider: 'google' });
      } catch (e) {
        setPendingPublish(false);
        setAuthError(e instanceof Error ? e.message : 'Could not start Google sign-in.');
      }
    }
  }, [identity, doPublish, initOAuth]);

  if (parseError || !proof) {
    return (
      <div style={styles.wrap}>
        <h1 style={styles.h1}>Publish proof</h1>
        <p style={styles.muted}>{parseError || 'No proof to publish.'}</p>
        <Link to="/" style={styles.link}>← Back to Human Ink</Link>
      </div>
    );
  }

  if (submit.phase === 'success') {
    const r = submit.result;
    return (
      <div style={styles.wrap}>
        <h1 style={styles.h1}>✓ Proof published on-chain</h1>
        <p style={styles.muted}>Your human-authorship proof is now recorded in HumanContentLedger.</p>
        <div style={styles.card}>
          {typeof r.entryId === 'number' && <Row k="Entry" v={`#${r.entryId}`} />}
          {r.transactionHash && <Row k="Tx" v={short(r.transactionHash)} />}
          {r.gasUsed && <Row k="Gas" v={String(r.gasUsed)} />}
          <Row k="Content hash" v={short(proof.contentHash)} />
          <Row k="Human signature" v={short(proof.humanSignatureHash)} />
        </div>
        <div style={styles.links}>
          {r.explorerTxUrl && <a style={styles.link} href={r.explorerTxUrl} target="_blank" rel="noreferrer">View transaction ↗</a>}
          {r.explorerContractUrl && <a style={styles.link} href={r.explorerContractUrl} target="_blank" rel="noreferrer">View contract ↗</a>}
        </div>
        <Link to="/" style={styles.link}>← Back to Human Ink</Link>
      </div>
    );
  }

  const busy = submit.phase === 'submitting' || pendingPublish;
  const primaryLabel = busy
    ? (identity.status === 'ready' ? 'Publishing…' : 'Setting up your account…')
    : identity.status === 'ready'
      ? 'Confirm & publish on-chain'
      : identity.status === 'needs-auth'
        ? 'Sign in with World App & publish'
        : 'Continue with Google & publish';

  return (
    <div style={styles.wrap}>
      <h1 style={styles.h1}>Publish proof of human writing</h1>
      <p style={styles.muted}>
        Captured by the Human Ink extension{proof.context === 'google-docs' ? ' from Google Docs' : ''}
        {proof.email ? ` · ${proof.email}` : ''}. Review and publish on-chain.
      </p>

      <div style={styles.card}>
        {proof.docTitle && <Row k="Document" v={proof.docTitle} />}
        {proof.url && <Row k="Source" v={proof.url} />}
        <Row k="Keystrokes" v={String(proof.keystrokeCount)} />
        <Row k="Typing speed" v={`${proof.typingSpeed.toFixed(1)} keys/sec`} />
        <Row k="Content hash" v={short(proof.contentHash)} />
        <Row k="Human signature" v={short(proof.humanSignatureHash)} />
      </div>

      {identity.status === 'ready' && (
        <p style={styles.muted}>
          Account <span style={styles.mono}>{short(identity.address)}</span> ({identity.source})
        </p>
      )}

      <button style={{ ...styles.primary, opacity: busy ? 0.6 : 1 }} disabled={busy} onClick={handlePrimary}>
        {primaryLabel}
      </button>

      {(authError || identity.authError) && <p style={styles.error}>{authError || identity.authError}</p>}
      {submit.phase === 'error' && <p style={styles.error}>{submit.message}</p>}

      <Link to="/" style={{ ...styles.link, marginTop: 16 }}>Cancel</Link>
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div style={styles.row}>
      <span style={styles.rowK}>{k}</span>
      <span style={styles.rowV}>{v}</span>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  wrap: { maxWidth: 460, margin: '32px auto', padding: '0 20px', color: 'inherit' },
  h1: { fontSize: 20, marginBottom: 6 },
  muted: { fontSize: 13, opacity: 0.7, margin: '6px 0' },
  error: { fontSize: 13, color: '#f87171', margin: '8px 0' },
  card: {
    border: '1px solid rgba(255,255,255,0.12)', borderRadius: 10, padding: 14,
    margin: '14px 0', background: 'rgba(255,255,255,0.03)',
  },
  row: { display: 'flex', justifyContent: 'space-between', gap: 12, padding: '5px 0', fontSize: 13 },
  rowK: { opacity: 0.6 },
  rowV: { fontFamily: 'ui-monospace, Menlo, monospace', wordBreak: 'break-all', textAlign: 'right' },
  mono: { fontFamily: 'ui-monospace, Menlo, monospace' },
  primary: {
    width: '100%', padding: '11px 14px', borderRadius: 8, border: 'none',
    background: '#6ee7b7', color: '#0b0d10', fontWeight: 650, fontSize: 14, cursor: 'pointer',
  },
  links: { display: 'flex', gap: 14, margin: '12px 0' },
  link: { color: '#6ee7b7', fontSize: 13, textDecoration: 'none', display: 'inline-block' },
};
