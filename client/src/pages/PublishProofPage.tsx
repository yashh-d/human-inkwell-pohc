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
 * DEMO MODE (SIMULATE = true): no wallet, no relayer, no real tx. We render the
 * full captured metrics + a simulated "GPT Zero"-style AI score (driven mainly
 * by the copy-paste signal for now) and a simulated on-chain receipt. Flip
 * SIMULATE to false to use the real gasless flow below (Privy embedded wallet →
 * EIP-712 → /api/relay → HumanContentLedger), and swap computeAiScore() for a
 * real AI-detector API call.
 */
const SIMULATE = true;

const CONTRACT_ADDRESS = '0x08A70Fed4d80893fC03Bd3E1D8cfb36E58a9E95d';
const EXPLORER_BASE = 'https://sepolia.worldscan.org';

type ProofMetrics = {
  wpm?: number;
  typingSpeedCharsPerSec?: number;
  keystrokeCount?: number;
  backspaceCount?: number;
  pasteCount?: number;
  pastedChars?: number;
  largestPaste?: number;
  bigPastes?: number;
  humanTypedRatio?: number;
  pageExits?: number;
  hiddenMs?: number;
  elapsedMs?: number;
  textLength?: number;
};

type RevisionAnalysis = {
  editCount: number;
  typedEdits: number;
  pasteEdits: number;
  typedChars: number;
  pastedChars: number;
  humanTypedRatio: number;
  largestPaste: number;
  timeline?: { type: 'type' | 'paste'; chars: number }[];
};

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
  metrics?: ProofMetrics;
  revision?: RevisionAnalysis | null;
};

const PROOF_KEY = 'humanink_pending_proof';

function b64urlDecode(s: string): string {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/');
  const pad = b64.length % 4 ? '='.repeat(4 - (b64.length % 4)) : '';
  return decodeURIComponent(escape(atob(b64 + pad)));
}

function loadProof(): { proof?: ExtensionProof; error?: string } {
  const m = (window.location.hash || '').match(/proof=([^&]+)/);
  if (m) {
    try {
      const obj = JSON.parse(b64urlDecode(m[1])) as ExtensionProof;
      if (!obj.contentHash || !obj.humanSignatureHash) return { error: 'Proof payload is missing its hashes.' };
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

/**
 * Simulated AI-detection score (stand-in for GPT Zero / an AI-detector API).
 * For the demo this is driven mainly by the copy-paste signal: the more of the
 * text arrived as large pastes vs. typed keystrokes, the more "AI-assisted".
 */
function computeAiScore(m: ProofMetrics) {
  const humanRatio = typeof m.humanTypedRatio === 'number' ? m.humanTypedRatio : 1;
  const pastedRatio = Math.max(0, Math.min(1, 1 - humanRatio));
  let ai = pastedRatio * 100;
  if ((m.bigPastes || 0) > 0) ai += Math.min(30, (m.bigPastes || 0) * 15);
  // Natural editing (backspaces) at a human cadence nudges back toward human.
  if ((m.backspaceCount || 0) > 0 && (m.wpm || 0) >= 15 && (m.wpm || 0) <= 110) ai -= 8;
  ai = Math.max(1, Math.min(99, Math.round(ai)));
  const human = 100 - ai;
  const verdict = ai < 30 ? 'Likely human' : ai <= 70 ? 'Mixed signals' : 'Likely AI-assisted';
  const color = ai < 30 ? '#6ee7b7' : ai <= 70 ? '#fbbf24' : '#f87171';
  return { ai, human, verdict, color, pastedRatio };
}

const fmtMs = (ms?: number) => {
  if (!ms) return '0s';
  const s = Math.round(ms / 1000);
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
};

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
  const [pendingPublish, setPendingPublish] = useState(false);

  const { initOAuth } = useLoginWithOAuth({
    onError: (err) => {
      setPendingPublish(false);
      setAuthError(typeof err === 'string' ? err : 'Google sign-in failed.');
    },
  });

  const ai = useMemo(() => (proof ? computeAiScore(proof.metrics || {}) : null), [proof]);

  useEffect(() => {
    if (proof && window.location.hash) {
      try { window.history.replaceState(null, '', window.location.pathname); } catch { /* no-op */ }
    }
  }, [proof]);

  // ---- DEMO: simulate the on-chain write (no wallet / relayer) ----
  const simulatePublish = useCallback(() => {
    if (!proof) return;
    setSubmit({ phase: 'submitting' });
    window.setTimeout(() => {
      const fakeTx = `0x${proof.contentHash.slice(0, 64)}`;
      const entryId = parseInt(proof.contentHash.slice(0, 6), 16) % 100000;
      try { sessionStorage.removeItem(PROOF_KEY); } catch { /* ignore */ }
      setSubmit({
        phase: 'success',
        result: {
          simulated: true,
          transactionHash: fakeTx,
          entryId,
          explorerContractUrl: `${EXPLORER_BASE}/address/${CONTRACT_ADDRESS}`,
        },
      });
    }, 700);
  }, [proof]);

  // ---- REAL: gasless sign + submit (used when SIMULATE = false) ----
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
      let privySigner: ethers.Signer | undefined;
      let privyAddress: string | undefined;
      if (identity.source === 'privy' && wallets && wallets.length > 0) {
        const wallet = wallets.find((w) => w.walletClientType === 'privy') || wallets[0];
        privyAddress = wallet.address;
        const provider = new ethers.BrowserProvider((await wallet.getEthereumProvider()) as any);
        privySigner = await provider.getSigner();
      }
      const result = await blockchainService.submitContent(submissionData, { onProgress: () => {}, privySigner, privyAddress });
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
        } catch (e) { console.warn('Ledger indexing failed (on-chain write still succeeded):', e); }
        try { sessionStorage.removeItem(PROOF_KEY); } catch { /* ignore */ }
        setSubmit({ phase: 'success', result });
      } else {
        setSubmit({ phase: 'error', message: result.error || 'Could not confirm the on-chain write.' });
      }
    } catch (e) {
      setSubmit({ phase: 'error', message: e instanceof Error ? e.message : String(e) });
    }
  }, [proof, identity, wallets]);

  useEffect(() => {
    if (!SIMULATE && pendingPublish && identity.status === 'ready' && submit.phase === 'idle') {
      setPendingPublish(false);
      doPublish();
    }
  }, [pendingPublish, identity.status, submit.phase, doPublish]);

  const handlePrimary = useCallback(() => {
    setAuthError(null);
    if (SIMULATE) { simulatePublish(); return; }
    if (identity.status === 'ready') doPublish();
    else if (identity.status === 'needs-auth') { setPendingPublish(true); identity.authenticate(); }
    else {
      setPendingPublish(true);
      try { initOAuth({ provider: 'google' }); }
      catch (e) { setPendingPublish(false); setAuthError(e instanceof Error ? e.message : 'Could not start Google sign-in.'); }
    }
  }, [identity, doPublish, initOAuth, simulatePublish]);

  if (parseError || !proof || !ai) {
    return (
      <div style={styles.wrap}>
        <h1 style={styles.h1}>Publish proof</h1>
        <p style={styles.muted}>{parseError || 'No proof to publish.'}</p>
        <Link to="/" style={styles.link}>← Back to Human Ink</Link>
      </div>
    );
  }

  const m = proof.metrics || {};
  const success = submit.phase === 'success';
  const busy = submit.phase === 'submitting' || (!SIMULATE && pendingPublish);

  return (
    <div style={styles.wrap}>
      <h1 style={styles.h1}>{success ? '✓ Proof published' : 'Proof of human writing'}</h1>
      <p style={styles.muted}>
        Captured by the Human Ink extension{proof.context === 'google-docs' ? ' from Google Docs' : ''}
        {proof.email ? ` · ${proof.email}` : ''}.{SIMULATE ? ' Demo — simulated on-chain write.' : ''}
      </p>

      {/* AI detection score (simulated) */}
      <div style={{ ...styles.card, borderColor: ai.color }}>
        <div style={styles.scoreHead}>
          <span style={styles.muted}>GPT Zero score <span style={styles.tag}>simulated</span></span>
          <span style={{ ...styles.verdict, color: ai.color }}>{ai.verdict}</span>
        </div>
        <div style={styles.barWrap}>
          <div style={{ ...styles.barFill, width: `${ai.human}%`, background: ai.color }} />
        </div>
        <div style={styles.scoreRow}>
          <span>Human {ai.human}%</span>
          <span>AI-assisted {ai.ai}%</span>
        </div>
      </div>

      {/* Captured behavioral metrics */}
      <div style={styles.grid}>
        <Stat k={m.wpm ?? 0} l="WPM" />
        <Stat k={m.keystrokeCount ?? proof.keystrokeCount} l="keystrokes" />
        <Stat k={m.backspaceCount ?? 0} l="backspaces" />
        <Stat k={m.pageExits ?? 0} l="page exits" />
        <Stat k={m.pasteCount ?? 0} l="pastes" />
        <Stat k={m.bigPastes ?? 0} l="big pastes" warn={(m.bigPastes ?? 0) > 0} />
      </div>

      <div style={styles.card}>
        {proof.docTitle && <Row k="Document" v={proof.docTitle} />}
        <Row k="Human-typed" v={`${Math.round((m.humanTypedRatio ?? 1) * 100)}%`} />
        <Row k="Pasted chars" v={String(m.pastedChars ?? 0)} />
        <Row k="Largest paste" v={`${m.largestPaste ?? 0} chars`} />
        <Row k="Session length" v={fmtMs(m.elapsedMs)} />
        <Row k="Hidden time" v={fmtMs(m.hiddenMs)} />
        <Row k="Content hash" v={short(proof.contentHash)} />
        <Row k="Human signature" v={short(proof.humanSignatureHash)} />
        {success && typeof submit.result.entryId === 'number' && <Row k="Ledger entry" v={`#${submit.result.entryId}`} />}
        {success && submit.result.transactionHash && <Row k="Tx" v={short(submit.result.transactionHash)} />}
      </div>

      {/* Revision analysis — edit timeline reconstructed from the capture */}
      {proof.revision && proof.revision.editCount > 0 && (() => {
        const rev = proof.revision!;
        const tp = Math.round(rev.humanTypedRatio * 100);
        const c = tp >= 90 ? '#6ee7b7' : tp >= 60 ? '#fbbf24' : '#f87171';
        return (
          <div style={styles.card}>
            <div style={styles.sec}>Revision analysis</div>
            <div style={styles.barWrap}><div style={{ ...styles.barFill, width: `${tp}%`, background: c }} /></div>
            <div style={styles.scoreRow}><span>Typed {tp}%</span><span>Pasted {100 - tp}%</span></div>
            <Row k="Edit events" v={String(rev.editCount)} />
            <Row k="Typing bursts" v={String(rev.typedEdits)} />
            {rev.pasteEdits > 0 && <Row k="Paste insertions" v={String(rev.pasteEdits)} />}
            {rev.timeline && rev.timeline.length > 0 && (
              <div style={styles.timeline}>
                {rev.timeline.map((e, i) => (
                  <span key={i} style={{ ...styles.chip, ...(e.type === 'paste' ? styles.chipPaste : styles.chipType) }}>
                    {e.type === 'paste' ? `📋 ${e.chars}` : `⌨ ${e.chars}`}
                  </span>
                ))}
              </div>
            )}
          </div>
        );
      })()}

      {success ? (
        <>
          <p style={styles.muted}>
            {submit.result.simulated ? 'Simulated write · World Chain Sepolia (demo)' : 'Recorded in HumanContentLedger.'}
          </p>
          {submit.result.explorerContractUrl && (
            <a style={styles.link} href={submit.result.explorerContractUrl} target="_blank" rel="noreferrer">View contract ↗</a>
          )}
          <Link to="/" style={{ ...styles.link, display: 'block', marginTop: 12 }}>← Back to Human Ink</Link>
        </>
      ) : (
        <>
          <button style={{ ...styles.primary, opacity: busy ? 0.6 : 1 }} disabled={busy} onClick={handlePrimary}>
            {busy ? 'Publishing…' : SIMULATE ? 'Publish proof on-chain' : 'Continue with Google & publish'}
          </button>
          {(authError || identity.authError) && <p style={styles.error}>{authError || identity.authError}</p>}
          {submit.phase === 'error' && <p style={styles.error}>{submit.message}</p>}
          <Link to="/" style={{ ...styles.link, marginTop: 14, display: 'block' }}>Cancel</Link>
        </>
      )}
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
function Stat({ k, l, warn }: { k: number | string; l: string; warn?: boolean }) {
  return (
    <div style={styles.stat}>
      <span style={{ ...styles.statK, color: warn ? '#fbbf24' : 'inherit' }}>{k}</span>
      <span style={styles.statL}>{l}</span>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  wrap: { maxWidth: 460, margin: '32px auto', padding: '0 20px', color: 'inherit' },
  h1: { fontSize: 20, marginBottom: 6 },
  muted: { fontSize: 13, opacity: 0.7, margin: '6px 0' },
  error: { fontSize: 13, color: '#f87171', margin: '8px 0' },
  tag: { fontSize: 9, textTransform: 'uppercase', letterSpacing: 0.5, opacity: 0.6, border: '1px solid currentColor', borderRadius: 4, padding: '1px 4px', marginLeft: 4 },
  card: { border: '1px solid rgba(255,255,255,0.14)', borderRadius: 10, padding: 14, margin: '12px 0', background: 'rgba(255,255,255,0.03)' },
  scoreHead: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  verdict: { fontSize: 13, fontWeight: 650 },
  barWrap: { height: 8, borderRadius: 999, background: 'rgba(255,255,255,0.12)', overflow: 'hidden' },
  barFill: { height: '100%', borderRadius: 999, transition: 'width 0.5s' },
  scoreRow: { display: 'flex', justifyContent: 'space-between', fontSize: 11, opacity: 0.7, marginTop: 5 },
  grid: { display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6, margin: '12px 0' },
  stat: { border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, padding: '8px 4px', textAlign: 'center', background: 'rgba(255,255,255,0.03)' },
  statK: { display: 'block', fontSize: 17, fontWeight: 650 },
  statL: { display: 'block', fontSize: 9, opacity: 0.6, marginTop: 2 },
  row: { display: 'flex', justifyContent: 'space-between', gap: 12, padding: '5px 0', fontSize: 13 },
  rowK: { opacity: 0.6 },
  rowV: { fontFamily: 'ui-monospace, Menlo, monospace', wordBreak: 'break-all', textAlign: 'right' },
  primary: { width: '100%', padding: '11px 14px', borderRadius: 8, border: 'none', background: '#6ee7b7', color: '#0b0d10', fontWeight: 650, fontSize: 14, cursor: 'pointer' },
  link: { color: '#6ee7b7', fontSize: 13, textDecoration: 'none' },
  sec: { fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.6, opacity: 0.6, marginBottom: 8 },
  timeline: { display: 'flex', flexWrap: 'wrap', gap: 3, marginTop: 10 },
  chip: { fontSize: 10, padding: '2px 6px', borderRadius: 4, whiteSpace: 'nowrap', border: '1px solid rgba(255,255,255,0.12)' },
  chipType: { background: 'rgba(110,231,183,0.14)', color: '#6ee7b7' },
  chipPaste: { background: 'rgba(251,191,36,0.16)', color: '#fbbf24' },
};
