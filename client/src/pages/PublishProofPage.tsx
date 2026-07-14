import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useLoginWithOAuth, useWallets } from '@privy-io/react-auth';
import { ethers } from 'ethers';
import { blockchainService } from '../blockchain';
import { pushLedgerIndexAfterOnChainSuccess } from '../ledgerSupabase';
import { useViewerAddress } from '../hooks/useViewerAddress';
import { rememberMiniKitWallet } from '../utils/miniKitWallet';
import {
  ExtensionProof, PasteOrigin, ScoreBands, RubricRow,
  DEFAULT_BANDS, PROOF_KEY, loadProof, short, fmtMs,
  computeAiScore, pasteBreakdown, computeAuthorshipScore,
  processBand, reasonLine, computeIntegrity, buildRubricAlignment,
} from "../lib/authorship";
import { publishCreatorPost } from '../creatorSupabase';

const CHAIN_ID = Number(process.env.REACT_APP_CHAIN_ID || 4801);


/**
 * /publish, entry point for the Human Ink Chrome extension.
 *
 * DEMO MODE (SIMULATE = true): no wallet, no relayer, no real tx. We render the
 * full captured metrics + a simulated "GPT Zero"-style AI score (driven mainly
 * by the copy-paste signal for now) and a simulated on-chain receipt. Flip
 * SIMULATE to false to use the real gasless flow below (Privy embedded wallet →
 * EIP-712 → /api/relay → HumanContentLedger), and swap computeAiScore() for a
 * real AI-detector API call.
 */
// Real gasless flow everywhere (Privy → EIP-712 → /api/relay → HumanContentLedger).
const SIMULATE = false;

// Real deployed contract + explorer, from the app's env (falls back to the
// known World Chain Sepolia deployment).
const CONTRACT_ADDRESS = process.env.REACT_APP_CONTRACT_ADDRESS || '0x08A70Fed4d80893fC03Bd3E1D8cfb36E58a9E95d';
const EXPLORER_BASE = (process.env.REACT_APP_BLOCKCHAIN_EXPLORER_URL || 'https://sepolia.worldscan.org').replace(/\/+$/, '');

type SubmitState =
  | { phase: 'idle' }
  | { phase: 'submitting' }
  | { phase: 'success'; result: any }
  | { phase: 'error'; message: string };

export default function PublishProofPage(
  { variant = 'student', injectedProof }: { variant?: 'student' | 'creator'; injectedProof?: ExtensionProof } = {},
) {
  const isCreator = variant === 'creator';
  // Creator variant renames the two metric labels only (same scores + layout).
  const scoreLabel = isCreator ? 'Grind Score' : 'Process Score';
  const aiLabel = isCreator ? 'Slop Score' : 'AI probability';
  // The creator flow hands its freshly-captured proof in memory (injectedProof)
  // so it never touches sessionStorage — otherwise a prior session's proof would
  // resurrect and skip the editor. The student flow still loads from the URL hash.
  const loaded = useMemo(loadProof, []);
  const proof = injectedProof ?? loaded.proof;
  const parseError = injectedProof ? undefined : loaded.error;
  const identity = useViewerAddress();
  const { wallets } = useWallets();
  const [submit, setSubmit] = useState<SubmitState>({ phase: 'idle' });
  const [authError, setAuthError] = useState<string | null>(null);
  const [pendingPublish, setPendingPublish] = useState(false);
  // A/B design toggle: A is the current report; B is the evidence-first redesign.
  const [view, setView] = useState<'a' | 'b'>('a');
  // Creator variant: opt into HI Feed BEFORE publishing, so the on-chain write
  // and the feed post happen from one action (the feed post fires automatically
  // once the tx confirms, since it needs the entry id + tx hash).
  const [feedOptIn, setFeedOptIn] = useState(true);
  const [feedName, setFeedName] = useState('');
  const [feedHandle, setFeedHandle] = useState('');
  const [feedExcerpt, setFeedExcerpt] = useState('');
  const [feedState, setFeedState] = useState<'idle' | 'saving' | 'done' | 'error'>('idle');
  const [feedMsg, setFeedMsg] = useState('');

  const { initOAuth } = useLoginWithOAuth({
    onError: (err) => {
      setPendingPublish(false);
      setAuthError(typeof err === 'string' ? err : 'Google sign-in failed.');
    },
  });

  const ai = useMemo(() => (proof ? computeAiScore(proof.metrics || {}) : null), [proof]);
  const authorship = useMemo(() => (proof ? computeAuthorshipScore(proof) : null), [proof]);
  const integrity = useMemo(() => (proof ? computeIntegrity(proof) : null), [proof]);

  // F2: evidence collapsed by default; score-bands are server-tunable (no deploy).
  const [showEvidence, setShowEvidence] = useState(false);
  const [bands, setBands] = useState<ScoreBands>(DEFAULT_BANDS);
  useEffect(() => {
    let alive = true;
    fetch('/api/scoring-config')
      .then((r) => (r.ok ? r.json() : null))
      .then((c) => {
        if (alive && c && typeof c.green === 'number' && typeof c.red === 'number') {
          setBands({ green: c.green, red: c.red });
        }
      })
      .catch(() => { /* defaults stand */ });
    return () => { alive = false; };
  }, []);

  // Optional professor flow: paste a rubric → process alignment.
  // DEMO: runs entirely client-side on the captured signals. The real Claude
  // Agent SDK version is parked at future/rubric-analyze.ts, swap runAlignment
  // to POST the rubric + process facts there when we wire the LLM back in.
  const [showRubric, setShowRubric] = useState(false);
  const [rubric, setRubric] = useState('');
  const [alignment, setAlignment] = useState<{ summary: string; rows: RubricRow[] } | null>(null);
  const runAlignment = useCallback(() => {
    if (proof && rubric.trim()) setAlignment(buildRubricAlignment(rubric, proof));
  }, [proof, rubric]);

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

  // Auto-post to HI Feed once the on-chain write confirms (creator + opted in).
  // Fires exactly once (guarded by feedState === 'idle'); skips simulated writes.
  useEffect(() => {
    if (!isCreator || !feedOptIn || feedState !== 'idle') return;
    if (submit.phase !== 'success') return;
    const result: any = submit.result;
    if (!result || result.simulated || !proof || !authorship || !ai) return;
    const entryId = typeof result.entryId === 'number' ? result.entryId : undefined;
    const tx: string | undefined = result.transactionHash;
    const author = result.walletAddress || (identity.status === 'ready' ? identity.address : '');
    if (typeof entryId !== 'number' || !tx || !author) return;
    setFeedState('saving');
    const mm = proof.metrics || {};
    publishCreatorPost({
      chain_id: CHAIN_ID,
      contract_address: CONTRACT_ADDRESS,
      entry_id: entryId,
      transaction_hash: tx,
      content_hash: proof.contentHash,
      author_address: author,
      title: proof.docTitle || undefined,
      excerpt: feedExcerpt.trim() || undefined,
      grind_score: authorship.score,
      ai_slop: ai.ai,
      human_pct: ai.human,
      word_count: Math.round((mm.textLength || mm.keystrokeCount || proof.keystrokeCount || 0) / 5),
      revisions: proof.docsRevision?.revisionCount || proof.revision?.editCount || 0,
      edit_days: proof.docsRevision?.editDays || ((mm.elapsedMs || 0) > 0 ? 1 : 0),
      minutes: Math.round((mm.elapsedMs || 0) / 60000),
      is_public: true,
      display_name: feedName.trim() || undefined,
      handle: feedHandle.trim().replace(/^@/, '').toLowerCase() || undefined,
    }).then((res) => {
      if (res.ok) { setFeedState('done'); setFeedMsg(res.deduped ? 'This piece is already on HI Feed.' : ''); }
      else { setFeedState('error'); setFeedMsg(res.error || 'Could not publish to HI Feed.'); }
    });
  }, [isCreator, feedOptIn, feedState, submit, proof, authorship, ai, identity, feedName, feedHandle, feedExcerpt]);

  if (parseError || !proof || !ai || !authorship || !integrity) {
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
  const band = processBand(authorship.score, bands);
  const reason = reasonLine(proof, authorship.score);
  const authorAddress = submit.phase === 'success'
    ? (submit.result?.walletAddress || (identity.status === 'ready' ? identity.address : ''))
    : '';

  if (view === 'b') {
    return (
      <PublishVersionB
        proof={proof} ai={ai} authorship={authorship} integrity={integrity} bands={bands}
        success={success} busy={busy} submit={submit} onPublish={handlePrimary}
        authError={authError} identityAuthError={identity.authError}
        view={view} setView={setView}
        isCreator={isCreator} authorAddress={authorAddress}
      />
    );
  }

  return (
    <div style={styles.wrap}>
      {!isCreator && <ViewToggle view={view} setView={setView} />}
      {!isCreator && <BrandKicker />}
      <h1 style={styles.h1}>{success ? '✓ Proof published' : 'Proof of human writing'}</h1>
      <p style={styles.muted}>
        {isCreator
          ? 'Written in the Human Ink editor'
          : `Captured by the Human Ink extension${proof.context === 'google-docs' ? ' from Google Docs' : ''}`}
        {proof.email ? ` · ${proof.email}` : ''}.{SIMULATE ? ' Demo, simulated on-chain write.' : ''}
      </p>

      {/* F2, two DECOUPLED metrics side by side. The Process Score is our own
          integrity measure; the AI probability is a separate post-hoc reference.
          They are never blended (a detector false-positive can't move the score). */}
      <div style={styles.heroRow}>
        <div style={{ ...styles.heroCard, borderColor: band.color, margin: 0 }}>
          <div style={styles.heroHead}>
            <span style={styles.heroLabel}>{scoreLabel}</span>
            <span style={{ ...styles.heroNum, color: band.color }}>{authorship.score}</span>
          </div>
          <div style={styles.barWrap}>
            <div style={{ ...styles.barFill, width: `${authorship.score}%`, background: band.color }} />
          </div>
          <div style={{ ...styles.bandPill, color: band.color, borderColor: band.color }}>{band.label}</div>
          <p style={styles.reasonLine}>{reason}</p>
        </div>
        <div style={{ ...styles.heroCard, borderColor: ai.color, margin: 0 }}>
          <div style={styles.heroHead}>
            <span style={styles.heroLabel}>{aiLabel} <span style={styles.tag}>simulated</span></span>
            <span style={{ ...styles.heroNum, color: ai.color }}>{ai.ai}%</span>
          </div>
          <div style={styles.barWrap}>
            <div style={{ ...styles.barFill, width: `${ai.ai}%`, background: ai.color }} />
          </div>
          <p style={styles.reasonLine}>Independent post-hoc detector, a parallel reference, not part of the {scoreLabel}.</p>
        </div>
      </div>

      <button style={styles.seeWhy} onClick={() => setShowEvidence((v) => !v)}>
        {showEvidence ? 'Hide evidence ▲' : 'See why ▼'}
      </button>

      {showEvidence && (
      <>
      {/* Evidence cards, then a drop-down with the per-signal breakdown (shared with B). */}
      <EvidenceCards proof={proof} authorship={authorship} />
      <ScoreCalcDetails authorship={authorship} scoreLabel={scoreLabel} />

      {/* On desktop these informational cards flow into 2–3 columns; on mobile
          they stack. Auto-fit grid → responsive without media queries. */}
      <div style={styles.bodyGrid}>
      {/* Revision authenticity, the anti-gaming check (real, always on) */}
      <div style={{ ...styles.card, borderColor: integrity.color }}>
        <div style={styles.scoreHead}>
          <span style={styles.muted}>Revision authenticity</span>
          <span style={{ ...styles.verdict, color: integrity.color }}>{integrity.verdict}</span>
        </div>
        <div style={styles.flagList}>
          {integrity.flags.map((f, i) => (
            <div key={i} style={styles.flag}>
              <span style={{ ...styles.flagDot, color: f.level === 'ok' ? '#6ee7b7' : f.level === 'warn' ? '#fbbf24' : '#f87171' }}>
                {f.level === 'ok' ? '✓' : f.level === 'warn' ? '!' : '✕'}
              </span>
              <span style={styles.flagText}>{f.text}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Captured behavioral metrics — header + grid stay in one cell so the
          heading always sits directly above its stats in the auto-fit layout. */}
      <div>
        <div style={{ ...styles.signalHead, marginTop: 4, marginBottom: 8 }}>Typing stats</div>
        <div style={styles.grid}>
          <Stat k={m.wpm ?? 0} l="WPM" />
          <Stat k={m.keystrokeCount ?? proof.keystrokeCount} l="keystrokes" />
          <Stat k={m.backspaceCount ?? 0} l="backspaces" />
          <Stat k={proof.docsRevision?.revisionCount ?? proof.revision?.editCount ?? 0} l="revisions" />
          <Stat k={m.pasteCount ?? 0} l="pastes" />
          <Stat k={m.bigPastes ?? 0} l="big pastes" warn={(m.bigPastes ?? 0) > 0} />
        </div>
      </div>

      <div style={styles.card}>
        {proof.docTitle && <Row k="Document" v={proof.docTitle} />}
        <Row k="Pasted chars" v={String(m.pastedChars ?? 0)} />
        <Row k="Largest paste" v={`${m.largestPaste ?? 0} chars`} />
        <Row k="Session length" v={fmtMs(m.elapsedMs)} />
        <Row k="Content hash" v={short(proof.contentHash)} />
        <Row k="Human signature" v={short(proof.humanSignatureHash)} />
        {success && typeof submit.result.entryId === 'number' && <Row k="Ledger entry" v={`#${submit.result.entryId}`} />}
        {success && submit.result.transactionHash && <Row k="Tx" v={short(submit.result.transactionHash)} />}
      </div>

      {/* Real Google Docs revision history (Drive API) */}
      {proof.docsRevision && proof.docsRevision.revisionCount > 0 && (
        <div style={styles.card}>
          <div style={styles.sec}>Google Docs revision history</div>
          <Row k="Saved revisions" v={String(proof.docsRevision.revisionCount)} />
          <Row
            k="Edited across"
            v={(() => {
              const d = proof.docsRevision.editDays || 0;
              const sp = proof.docsRevision.spanDays || 0;
              return d <= 1 ? '1 day' : `${d} days${sp > d ? ` (over ${sp})` : ''}`;
            })()}
          />
          {proof.docsRevision.firstModified && (
            <Row
              k="Date range"
              v={`${new Date(proof.docsRevision.firstModified).toLocaleDateString()} → ${new Date(proof.docsRevision.lastModified!).toLocaleDateString()}`}
            />
          )}
          <Row k="Editors" v={proof.docsRevision.authors.length ? proof.docsRevision.authors.join(', ') : '-'} />
        </div>
      )}

      </div>{/* end bodyGrid */}

      {/* For professors, optional rubric → AI-assisted process alignment.
          Hidden for the creator variant (no grader in the loop). */}
      {!isCreator && (
      <div style={styles.card}>
        {!showRubric ? (
          <button style={styles.ghostBtn} onClick={() => setShowRubric(true)}>
            + For professors: check against a rubric <span style={styles.tag}>optional</span>
          </button>
        ) : (
          <>
            <div style={styles.sec}>
              Rubric alignment <span style={styles.tag}>demo</span>
            </div>
            <p style={styles.muted}>Paste your existing rubric, one criterion per line. We report how the writing process lines up with each. It’s a second opinion, not a grade.</p>
            <textarea
              style={styles.textarea}
              value={rubric}
              onChange={(e) => setRubric(e.target.value)}
              placeholder={'e.g.\n1. Develops a clear thesis\n2. Supports claims with cited evidence\n3. Shows revision and editing\n4. Grammar and clarity'}
              rows={5}
            />
            <button
              style={{ ...styles.primary, marginTop: 8, opacity: rubric.trim() ? 1 : 0.6 }}
              disabled={!rubric.trim()}
              onClick={runAlignment}
            >
              Analyze against rubric
            </button>
            {alignment && (
              <div style={{ marginTop: 12 }}>
                <p style={{ ...styles.muted, fontStyle: 'italic' }}>{alignment.summary}</p>
                {alignment.rows.map((r, i) => (
                  <div key={i} style={styles.rubricRow}>
                    <div style={styles.rubricCrit}>
                      {r.criterion}
                      {r.alignment && (
                        <span style={{ ...styles.alignTag, ...alignTagStyle(r.alignment) }}>{r.alignment}</span>
                      )}
                    </div>
                    <div style={styles.rubricNote}>{r.note}</div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>
      )}

      {/* Revision-analysis charts, organized + enlarged, at the bottom. */}
      <RevisionCharts proof={proof} />

      </>
      )}

      {success ? (
        <>
          <Receipt result={submit.result} />
          {isCreator && feedOptIn && <HIFeedStatus state={feedState} msg={feedMsg} />}
          {isCreator && !feedOptIn && <HIFeedOptIn proof={proof} result={submit.result} authorship={authorship} ai={ai} authorAddress={authorAddress} />}
        </>
      ) : (
        <>
          {isCreator && (
            <HIFeedToggle
              optIn={feedOptIn} setOptIn={setFeedOptIn}
              name={feedName} setName={setFeedName}
              handle={feedHandle} setHandle={setFeedHandle}
              excerpt={feedExcerpt} setExcerpt={setFeedExcerpt}
            />
          )}
          <button style={{ ...styles.primary, opacity: busy ? 0.6 : 1 }} disabled={busy} onClick={handlePrimary}>
            {busy ? 'Publishing…' : SIMULATE ? 'Publish proof on-chain' : isCreator && feedOptIn ? 'Continue with Google & publish to HI Feed' : 'Continue with Google & publish'}
          </button>
          {(authError || identity.authError) && <p style={styles.error}>{authError || identity.authError}</p>}
          {submit.phase === 'error' && <p style={styles.error}>{submit.message}</p>}
          <Link to="/" style={{ ...styles.link, marginTop: 14, display: 'block' }}>Cancel</Link>
        </>
      )}
      <ProofSignoff />
    </div>
  );
}

/** Small pill toggle to flip between the two report designs (A = current, B = new). */
function ViewToggle({ view, setView }: { view: 'a' | 'b'; setView: (v: 'a' | 'b') => void }) {
  const btn = (v: 'a' | 'b', label: string) => (
    <button
      onClick={() => setView(v)}
      style={{
        padding: '5px 12px', borderRadius: 999, fontSize: 12, fontWeight: 650, cursor: 'pointer',
        border: '1px solid', borderColor: view === v ? '#6ee7b7' : 'rgba(127,127,127,0.4)',
        background: view === v ? 'rgba(110,231,183,0.15)' : 'transparent',
        color: view === v ? '#6ee7b7' : 'inherit',
      }}
    >{label}</button>
  );
  return (
    <div style={{ display: 'flex', gap: 6, justifyContent: 'center', margin: '0 0 16px' }}>
      {btn('a', 'Version A')}{btn('b', 'Version B · new')}
    </div>
  );
}

/** Cyan ink-drop glyph — the recurring Human Ink brand mark (theme-independent SVG). */
function InkDrop({ size = 15 }: { size?: number }) {
  return (
    <svg width={size} height={Math.round(size * 1.2)} viewBox="0 0 15 18" fill="none" aria-hidden
      style={{ display: 'block', flex: '0 0 auto' }}>
      <path d="M7.5 1.2C7.5 1.2 1 8.4 1 12A6.5 6.5 0 0 0 14 12C14 8.4 7.5 1.2 7.5 1.2Z" fill="var(--hi-cyan, #00b4d8)" />
      <path d="M10.4 12.4a3 3 0 0 1-2.9 2.5" stroke="#fff" strokeWidth="1.2" strokeLinecap="round" opacity="0.6" />
    </svg>
  );
}

/** Brand eyebrow above the page title: ink-drop + HUMAN INK wordmark. Subtle, on-brand. */
function BrandKicker() {
  return (
    <div style={styles.kicker}>
      <InkDrop size={14} />
      <span style={styles.kickerText}>Human Ink</span>
    </div>
  );
}

/** In-page proof sign-off: frames the report as sealed by Human Ink, powered by World. */
function ProofSignoff() {
  return (
    <div style={styles.signoff}>
      <span style={styles.signoffMark}>
        <InkDrop size={13} />
        <span style={styles.signoffBrand}>Sealed with Human Ink</span>
      </span>
      <span style={styles.signoffDot} aria-hidden>·</span>
      <span style={styles.signoffPowered}>powered by</span>
      <a href="https://world.org" target="_blank" rel="noopener noreferrer" style={styles.signoffWorld}
        aria-label="World. Visit world.org">
        <img src="/brand/world-icon.png" alt="" width={15} height={15} style={{ display: 'block', flex: '0 0 auto' }} />
        <span style={styles.signoffWorldWord}>world</span>
      </a>
    </div>
  );
}

/** ■■■□□ strength bar for the evidence cards (words/visuals over arbitrary numbers). */
function Blocks({ score, total = 5 }: { score: number; total?: number }) {
  const filled = Math.max(0, Math.min(total, Math.round((score / 100) * total)));
  return (
    <span style={{ letterSpacing: 2, fontSize: 13, fontFamily: 'ui-monospace, Menlo, monospace' }}>
      <span style={{ color: '#6ee7b7' }}>{'■'.repeat(filled)}</span>
      <span style={{ opacity: 0.28 }}>{'□'.repeat(total - filled)}</span>
    </span>
  );
}

const PLAIN_LABEL: Record<string, string> = {
  revision: 'Revision history',
  typed: 'Original writing',
  time: 'Time invested',
  'time-span': 'Writing timeline',
};

/**
 * Version B, the evidence-first redesign. Same scoring + telemetry as A; only the
 * narrative order and copy change: lead with "Evidence of Human Authorship" + a
 * plain-English verdict and assessment, keep the Process Score as the supporting
 * number, surface authentic-revision near the top, explain how the score is built,
 * and relegate the AI detector + technical hashes to small secondary/advanced areas.
 */
function PublishVersionB({
  proof, ai, authorship, integrity, bands,
  success, busy, submit, onPublish, authError, identityAuthError, view, setView,
  isCreator, authorAddress,
}: {
  proof: ExtensionProof;
  ai: ReturnType<typeof computeAiScore>;
  authorship: ReturnType<typeof computeAuthorshipScore>;
  integrity: ReturnType<typeof computeIntegrity>;
  bands: ScoreBands;
  success: boolean;
  busy: boolean;
  submit: SubmitState;
  onPublish: () => void;
  authError: string | null;
  identityAuthError?: string | null;
  view: 'a' | 'b';
  setView: (v: 'a' | 'b') => void;
  isCreator?: boolean;
  authorAddress?: string;
}) {
  const [adv, setAdv] = useState(false);
  const m = proof.metrics || {};
  const scoreLabel = isCreator ? 'Grind Score' : 'Process Score';
  const aiLabel = isCreator ? 'Slop Score' : 'AI probability';
  // success is a prop here (not a local alias of submit.phase), so TS can't narrow
  // submit.result, derive it explicitly from the discriminant.
  const result: any = submit.phase === 'success' ? submit.result : null;
  const band = processBand(authorship.score, bands);
  const pb = pasteBreakdown(proof);
  const docs = proof.docsRevision || null;
  const rev = proof.revision || null;

  const verdictWord = band.tone === 'green' ? 'Strong' : band.tone === 'yellow' ? 'Moderate' : 'Limited';
  const confidence = band.tone === 'green' ? 'High' : band.tone === 'yellow' ? 'Moderate' : 'Low';
  const typedPct = Math.round(pb.writtenRatio * 100);
  const editEvents = rev?.editCount || 0;
  const revisions = docs?.revisionCount || 0;
  const passes = revisions || editEvents;
  const editDays = docs?.editDays || 0;
  const largeBulk = pb.penalizedExternal > 0 && pb.largestExternal >= 120;

  // Assessment bullets, the story a professor reads in 20 seconds.
  const bullets: string[] = [];
  bullets.push(`${typedPct}% of the text was typed directly`);
  if (pb.externalChars === 0) bullets.push('No text pasted in from outside the document');
  else if (largeBulk) bullets.push(`A large block (${pb.largestExternal} chars) was pasted in from outside`);
  else bullets.push(`Small pasted section only (${pb.externalChars} characters)`);
  if (passes) bullets.push(`${passes} editing ${passes === 1 ? 'event' : 'events'} captured`);
  bullets.push(editDays >= 2 ? `Writing occurred across ${editDays} days` : 'Writing occurred in one session');
  if (!largeBulk) bullets.push('No large bulk insertion detected');

  const assessmentLead = band.tone === 'red'
    ? 'Limited writing history was captured for this document. That does not imply AI use, but more process evidence would raise confidence.'
    : 'This document shows evidence consistent with genuine human writing.';

  return (
    <div style={styles.wrap}>
      {!isCreator && <ViewToggle view={view} setView={setView} />}
      {!isCreator && <BrandKicker />}
      <h1 style={styles.h1}>{success ? '✓ Proof published' : 'Proof of Human Writing'}</h1>

      {/* What Human Ink measures, framing up front to distinguish from AI detectors. */}
      <p style={styles.muted}>
        Human Ink evaluates how a document was created, its writing activity, revisions and editing
        history, rather than judging the final wording. Captured from
        {proof.context === 'google-docs' ? ' Google Docs' : ' the web'}{proof.email ? ` · ${proof.email}` : ''}.
      </p>

      {/* HERO, evidence of authorship is the headline; the score is supporting. */}
      <div style={{ ...styles.heroCard, borderColor: band.color, margin: '14px 0' }}>
        <div style={{ fontSize: 13, fontWeight: 650, opacity: 0.8 }}>Evidence of Human Authorship</div>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, margin: '6px 0 2px' }}>
          <span style={{ fontSize: 34, fontWeight: 800, color: band.color }}>{verdictWord}</span>
          <span style={{ fontSize: 13, opacity: 0.7 }}>Confidence: {confidence}</span>
        </div>
        <div style={{ ...styles.barWrap, marginTop: 8 }}>
          <div style={{ ...styles.barFill, width: `${authorship.score}%`, background: band.color }} />
        </div>
        <div style={{ fontSize: 12, opacity: 0.7, marginTop: 8 }}>
          {scoreLabel} <strong style={{ color: band.color }}>{authorship.score}</strong> / 100, our measure of captured writing process.
        </div>
      </div>

      {/* ASSESSMENT, the narrative a professor can read in 20 seconds. */}
      <div style={styles.card}>
        <div style={styles.signalHead}>Assessment</div>
        <p style={{ fontSize: 13.5, lineHeight: 1.5, margin: '2px 0 10px' }}>{assessmentLead}</p>
        <div style={styles.flagList}>
          {bullets.map((b, i) => (
            <div key={i} style={styles.flag}>
              <span style={{ ...styles.flagDot, color: '#6ee7b7' }}>•</span>
              <span style={styles.flagText}>{b}</span>
            </div>
          ))}
        </div>
        <p style={{ ...styles.muted, marginTop: 10, fontStyle: 'italic' }}>The evidence below supports this conclusion.</p>
      </div>

      {/* AUTHENTIC REVISION, one of the strongest trust signals, placed up high. */}
      <div style={{ ...styles.card, borderColor: integrity.color }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: integrity.color, marginBottom: 8 }}>
          {integrity.verdict === 'Revisions look authentic' ? '✓ Authentic revision history' : integrity.verdict}
        </div>
        <div style={styles.flagList}>
          {integrity.flags.slice(0, 4).map((f, i) => (
            <div key={i} style={styles.flag}>
              <span style={{ ...styles.flagDot, color: f.level === 'ok' ? '#6ee7b7' : f.level === 'warn' ? '#fbbf24' : '#f87171' }}>
                {f.level === 'ok' ? '✓' : f.level === 'warn' ? '!' : '✕'}
              </span>
              <span style={styles.flagText}>{f.text}</span>
            </div>
          ))}
        </div>
      </div>

      {/* EVIDENCE CARDS, then a drop-down with the per-signal breakdown (shared with A). */}
      <EvidenceCards proof={proof} authorship={authorship} />
      <ScoreCalcDetails authorship={authorship} scoreLabel={scoreLabel} />

      {/* AI PROBABILITY, deliberately small and secondary (same framing as A). */}
      <div style={{ ...styles.card, padding: '10px 14px', opacity: 0.85 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
          <span style={{ fontSize: 12, opacity: 0.7 }}>{aiLabel} <span style={styles.tag}>simulated</span></span>
          <span style={{ fontSize: 18, fontWeight: 700, color: ai.color }}>{ai.ai}%</span>
        </div>
        <p style={{ ...styles.muted, margin: '4px 0 0' }}>
          Independent post-hoc detector, a parallel reference, not part of the {scoreLabel}.
        </p>
      </div>

      {/* REVISION CHARTS, organized + enlarged, at the bottom of the report. */}
      <RevisionCharts proof={proof} />

      {/* ADVANCED, technical metadata tucked away for auditors. */}
      <div style={styles.card}>
        <button style={styles.ghostBtn} onClick={() => setAdv((v) => !v)}>
          {adv ? 'Hide advanced verification ▲' : 'Advanced verification ▼'}
        </button>
        {adv && (
          <div style={{ marginTop: 8 }}>
            {proof.docTitle && <Row k="Document" v={proof.docTitle} />}
            <Row k="Content hash" v={short(proof.contentHash)} />
            <Row k="Human signature" v={short(proof.humanSignatureHash)} />
            <Row k="WPM" v={String(m.wpm ?? 0)} />
            <Row k="Keystrokes" v={String(m.keystrokeCount ?? proof.keystrokeCount)} />
            <Row k="Backspaces" v={String(m.backspaceCount ?? 0)} />
            <Row k="Pasted chars" v={String(m.pastedChars ?? 0)} />
            {success && typeof result?.entryId === 'number' && <Row k="Ledger entry" v={`#${result.entryId}`} />}
            {success && result?.transactionHash && <Row k="Tx" v={short(result.transactionHash)} />}
          </div>
        )}
      </div>

      {success ? (
        <>
          <Receipt result={result} />
          {isCreator && <HIFeedOptIn proof={proof} result={result} authorship={authorship} ai={ai} authorAddress={authorAddress || ''} />}
        </>
      ) : (
        <>
          <button style={{ ...styles.primary, opacity: busy ? 0.6 : 1 }} disabled={busy} onClick={onPublish}>
            {busy ? 'Publishing…' : SIMULATE ? 'Publish proof on-chain' : 'Continue with Google & publish'}
          </button>
          {(authError || identityAuthError) && <p style={styles.error}>{authError || identityAuthError}</p>}
          {submit.phase === 'error' && <p style={styles.error}>{submit.message}</p>}
          <Link to="/" style={{ ...styles.link, marginTop: 14, display: 'block' }}>Cancel</Link>
        </>
      )}
      <ProofSignoff />
    </div>
  );
}

/** Shared: "How the Process Score is built", per-signal +points + strength bar. */
/**
 * On-chain receipt shown after a successful publish. The transaction is the proof,
 * so the full tx hash is selectable + copyable with prominent links to the
 * explorer (transaction AND contract), not buried as a truncated row.
 */
/**
 * HI Feed opt-in shown BEFORE publishing (creator variant). Ticking this makes
 * the on-chain publish and the feed post one action — the feed post fires
 * automatically once the tx confirms (see the auto-post effect).
 */
function HIFeedToggle({
  optIn, setOptIn, name, setName, handle, setHandle, excerpt, setExcerpt,
}: {
  optIn: boolean; setOptIn: (v: boolean) => void;
  name: string; setName: (v: string) => void;
  handle: string; setHandle: (v: string) => void;
  excerpt: string; setExcerpt: (v: string) => void;
}) {
  return (
    <div style={styles.card}>
      <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 14, fontWeight: 600 }}>
        <input type="checkbox" checked={optIn} onChange={(e) => setOptIn(e.target.checked)} style={{ width: 16, height: 16 }} />
        Also publish to HI Feed
      </label>
      <p style={{ ...styles.muted, margin: '6px 0 0' }}>
        Share this piece on the public feed of human-written work. It’s posted together with the on-chain write.
      </p>
      {optIn && (
        <>
          <input style={styles.input} placeholder="Display name" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} />
          <input style={styles.input} placeholder="@handle (optional)" value={handle} onChange={(e) => setHandle(e.target.value)} maxLength={40} />
          <textarea style={styles.textarea} placeholder="Optional: a one-line teaser for the feed card" value={excerpt} onChange={(e) => setExcerpt(e.target.value)} rows={2} maxLength={280} />
        </>
      )}
    </div>
  );
}

/** Post-publish status for the pre-opted-in HI Feed post (creator variant). */
function HIFeedStatus({ state, msg }: { state: 'idle' | 'saving' | 'done' | 'error'; msg: string }) {
  if (state === 'idle') return null;
  return (
    <div style={styles.card}>
      <div style={styles.sec}>HI Feed</div>
      {state === 'saving' && <p style={styles.muted}>Publishing to HI Feed…</p>}
      {state === 'done' && (
        <>
          <p style={styles.muted}>{msg || 'Published to HI Feed.'}</p>
          <Link to="/feed" style={styles.link}>View HI Feed →</Link>
        </>
      )}
      {state === 'error' && <p style={styles.error}>{msg}</p>}
    </div>
  );
}

/**
 * HI Feed opt-in shown AFTER publishing (creator variant, fallback for when the
 * pre-publish box was unticked). Requires a real, verified on-chain entry — the
 * API anchors the feed post to the ledger row. Uses the report's own styles.
 */
function HIFeedOptIn({
  proof, result, authorship, ai, authorAddress,
}: {
  proof: ExtensionProof;
  result: any;
  authorship: ReturnType<typeof computeAuthorshipScore>;
  ai: ReturnType<typeof computeAiScore>;
  authorAddress: string;
}) {
  const [name, setName] = useState('');
  const [handle, setHandle] = useState('');
  const [excerpt, setExcerpt] = useState('');
  const [state, setState] = useState<'idle' | 'saving' | 'done' | 'error'>('idle');
  const [msg, setMsg] = useState('');

  const entryId: number | undefined = typeof result?.entryId === 'number' ? result.entryId : undefined;
  const tx: string | undefined = result?.transactionHash;
  const simulated = !!result?.simulated;
  const canPublish = typeof entryId === 'number' && !!tx && !!authorAddress && !simulated;

  const m = proof.metrics || {};
  const words = Math.round((m.textLength || m.keystrokeCount || proof.keystrokeCount || 0) / 5);
  const revisions = proof.docsRevision?.revisionCount || proof.revision?.editCount || 0;
  const editDays = proof.docsRevision?.editDays || ((m.elapsedMs || 0) > 0 ? 1 : 0);
  const minutes = Math.round((m.elapsedMs || 0) / 60000);

  const submitPost = async () => {
    setState('saving'); setMsg('');
    const res = await publishCreatorPost({
      chain_id: CHAIN_ID,
      contract_address: CONTRACT_ADDRESS,
      entry_id: entryId!,
      transaction_hash: tx!,
      content_hash: proof.contentHash,
      author_address: authorAddress,
      title: proof.docTitle || undefined,
      excerpt: excerpt.trim() || undefined,
      grind_score: authorship.score,
      ai_slop: ai.ai,
      human_pct: ai.human,
      word_count: words,
      revisions,
      edit_days: editDays,
      minutes,
      is_public: true,
      display_name: name.trim() || undefined,
      handle: handle.trim().replace(/^@/, '').toLowerCase() || undefined,
    });
    if (res.ok) { setState('done'); setMsg(res.deduped ? 'This piece is already on HI Feed.' : ''); }
    else { setState('error'); setMsg(res.error || 'Could not publish to HI Feed.'); }
  };

  if (state === 'done') {
    return (
      <div style={styles.card}>
        <div style={styles.sec}>HI Feed</div>
        <p style={styles.muted}>{msg || 'Published to HI Feed.'}</p>
        <Link to="/feed" style={styles.link}>View HI Feed →</Link>
      </div>
    );
  }

  return (
    <div style={styles.card}>
      <div style={styles.sec}>Publish to HI Feed <span style={styles.tag}>optional</span></div>
      <p style={styles.muted}>
        HI Feed is the public feed of human-written work. Opt in to share this piece there — your Grind Score and on-chain proof go with it.
      </p>
      {!canPublish ? (
        <p style={styles.muted}>
          {simulated
            ? 'Publishing to HI Feed is available on real on-chain posts.'
            : 'Available once the on-chain write confirms.'}
        </p>
      ) : (
        <>
          <input style={styles.input} placeholder="Display name" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} />
          <input style={styles.input} placeholder="@handle (optional)" value={handle} onChange={(e) => setHandle(e.target.value)} maxLength={40} />
          <textarea style={styles.textarea} placeholder="Optional: a one-line teaser for the feed card" value={excerpt} onChange={(e) => setExcerpt(e.target.value)} rows={2} maxLength={280} />
          <button
            style={{ ...styles.primary, marginTop: 10, opacity: state === 'saving' ? 0.6 : 1 }}
            disabled={state === 'saving'}
            onClick={submitPost}
          >
            {state === 'saving' ? 'Publishing…' : 'Publish to HI Feed'}
          </button>
          {state === 'error' && <p style={styles.error}>{msg}</p>}
        </>
      )}
    </div>
  );
}

function Receipt({ result }: { result: any }) {
  const [copied, setCopied] = useState(false);
  const tx: string | undefined = result?.transactionHash;
  const txUrl = tx ? `${EXPLORER_BASE}/tx/${tx}` : null;
  const contractUrl: string = result?.explorerContractUrl || `${EXPLORER_BASE}/address/${CONTRACT_ADDRESS}`;
  const copyTx = () => {
    if (!tx) return;
    try {
      navigator.clipboard.writeText(tx);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch { /* clipboard unavailable */ }
  };
  return (
    <div style={{ marginTop: 10 }}>
      <p style={styles.muted}>{result?.simulated ? 'Simulated write · World Chain (demo)' : 'Recorded on-chain in HumanContentLedger.'}</p>

      {typeof result?.entryId === 'number' && (
        <div style={styles.row}><span style={styles.rowK}>Ledger entry</span><span style={styles.rowV}>#{result.entryId}</span></div>
      )}

      {tx && (
        <div style={{ ...styles.card, marginTop: 10 }}>
          <div style={styles.receiptLabel}>Transaction hash</div>
          <div style={styles.receiptHash}>{tx}</div>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 10 }}>
            {txUrl && <a style={styles.receiptBtn} href={txUrl} target="_blank" rel="noreferrer">View transaction ↗</a>}
            <button style={styles.receiptBtn} onClick={copyTx}>{copied ? 'Copied ✓' : 'Copy hash'}</button>
          </div>
        </div>
      )}

      <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', marginTop: 14 }}>
        <a style={styles.link} href={contractUrl} target="_blank" rel="noreferrer">View contract ↗</a>
        <Link to="/" style={styles.link}>← Back to Human Ink</Link>
      </div>
    </div>
  );
}

function ScoreBreakdown({ authorship, scoreLabel = 'Process Score' }: { authorship: ReturnType<typeof computeAuthorshipScore>; scoreLabel?: string }) {
  const live = authorship.signals.filter((s) => s.has);
  const totalWeight = live.reduce((s, x) => s + x.weight, 0) || 1;
  // Each signal's points = its normalized score × its share of the live weight,
  // exactly how the raw score is computed. The strength bar shows that same
  // normalized score (0–100% → 0–5 blocks), so the bar and the +points agree.
  const rows = live.map((s) => ({
    label: PLAIN_LABEL[s.key] || s.label,
    detail: s.detail,
    pts: Math.round((s.score * s.weight) / totalWeight),
    score: s.score,
  }));
  // Reconcile to the headline: any gap between the signal points and the final
  // score is the F3 protection floor (e.g. linear-thinker) or rounding. Show it so
  // the visible numbers always add up to the Process Score.
  const sum = rows.reduce((a, r) => a + r.pts, 0);
  const adjustment = authorship.score - sum;
  const adjLabel = authorship.protections.length > 0 ? 'Protection floor' : 'Rounding';
  return (
    <div style={styles.card}>
      <div style={styles.signalHead}>How the {scoreLabel} is built</div>
      <div style={styles.flagList}>
        {rows.map((c, i) => (
          <div key={i} style={{ ...styles.row, padding: '6px 0', alignItems: 'center' }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
              <span style={{ color: c.score < 50 ? '#fbbf24' : '#6ee7b7', fontWeight: 700, width: 34, flexShrink: 0 }}>+{c.pts}</span>
              <span style={{ minWidth: 0 }}>
                <span style={{ fontSize: 13, fontWeight: 600, display: 'block' }}>{c.label}</span>
                <span style={{ fontSize: 11, opacity: 0.6 }}>{c.detail}</span>
              </span>
            </span>
            <Blocks score={c.score} total={5} />
          </div>
        ))}
        {adjustment !== 0 && (
          <div style={{ ...styles.row, padding: '6px 0', alignItems: 'center' }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ color: '#6ee7b7', fontWeight: 700, width: 34, flexShrink: 0 }}>{adjustment > 0 ? `+${adjustment}` : adjustment}</span>
              <span style={{ fontSize: 13, fontWeight: 600 }}>{adjLabel}</span>
            </span>
          </div>
        )}
        <div style={{ ...styles.row, padding: '8px 0 0', marginTop: 4, borderTop: '1px solid rgba(127,127,127,0.25)', fontWeight: 700 }}>
          <span>{scoreLabel}</span>
          <span>{authorship.score} / 100</span>
        </div>
      </div>
      {authorship.protections.map((p, i) => (
        <div key={i} style={{ ...styles.flag, marginTop: 8 }}>
          <span style={{ ...styles.flagDot, color: '#6ee7b7' }}>✓</span>
          <span style={styles.flagText}>{p}</span>
        </div>
      ))}
    </div>
  );
}

/**
 * Collapsible "see how the score was calculated", the per-signal breakdown dropped
 * down on demand below the evidence cards (replaces the always-open block).
 */
function ScoreCalcDetails({ authorship, scoreLabel = 'Process Score' }: { authorship: ReturnType<typeof computeAuthorshipScore>; scoreLabel?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ margin: '2px 0 12px' }}>
      <button style={styles.ghostBtn} onClick={() => setOpen((v) => !v)}>
        {open ? 'Hide how the score was calculated ▲' : 'See how the score was calculated ▼'}
      </button>
      {open && <ScoreBreakdown authorship={authorship} scoreLabel={scoreLabel} />}
    </div>
  );
}

/** Small hover "ⓘ" that reveals a one-paragraph explanation of an evidence signal. */
function InfoDot({ text }: { text: string }) {
  const [show, setShow] = useState(false);
  return (
    <span
      style={{ position: 'relative', display: 'inline-flex' }}
      onMouseEnter={() => setShow(true)}
      onMouseLeave={() => setShow(false)}
    >
      <span style={styles.infoDot} tabIndex={0} onFocus={() => setShow(true)} onBlur={() => setShow(false)} aria-label={text}>i</span>
      {show && <span style={styles.infoTip}>{text}</span>}
    </span>
  );
}

/** Shared: the four evidence cards (plain label + strength bar + value + context). */
function EvidenceCards({ proof, authorship }: { proof: ExtensionProof; authorship: ReturnType<typeof computeAuthorshipScore> }) {
  const m = proof.metrics || {};
  const pb = pasteBreakdown(proof);
  const docs = proof.docsRevision || null;
  const rev = proof.revision || null;
  const typedPct = Math.round(pb.writtenRatio * 100);
  const passes = (docs?.revisionCount || 0) || (rev?.editCount || 0);
  const editDays = docs?.editDays || 0;
  const largeBulk = pb.penalizedExternal > 0 && pb.largestExternal >= 120;
  const sigScore = (key: string) => authorship.signals.find((s) => s.key === key)?.score ?? 0;
  const words = Math.round((m.textLength || m.keystrokeCount || proof.keystrokeCount || 0) / 5);
  const loMin = Math.max(1, Math.round(words / 45));
  const hiMin = Math.max(loMin + 1, Math.round(words / 25));
  const timeContext = words >= 40
    ? `A ~${words.toLocaleString()}-word document is roughly ${loMin}–${hiMin} min of active writing.`
    : 'Active typing time, with idle gaps excluded.';
  return (
    <div style={styles.bodyGrid}>
      <EvidenceCard label="Revision history" value={passes ? `${passes} editing ${passes === 1 ? 'pass' : 'passes'}` : 'none captured'} score={sigScore('revision')} note="Drafts and rewrites are the fingerprint of real effort." info="Every draft, rewrite, and edit pass we captured while you worked. Saved revisions and edit events both count — more genuine passes lift this signal. A revision history is very hard to fabricate after the fact." />
      <EvidenceCard label="Original writing" value={`${typedPct}% typed`} score={sigScore('typed')} note={largeBulk ? `Largest pasted block: ${pb.largestExternal} chars.` : 'No large bulk insertions.'} info="The share of your text that was typed rather than pasted in. Short quotes are fine; large bulk insertions from outside the document lower this signal." />
      <EvidenceCard label="Time invested" value={fmtMs(m.elapsedMs)} score={sigScore('time')} note={timeContext} info="Active typing time only — long idle gaps are excluded, so leaving the tab open doesn't inflate it. It's weighed against your document's length to judge whether the pace is plausible." />
      <EvidenceCard label="Writing timeline" value={editDays <= 1 ? '1 day' : `${editDays} days`} score={sigScore('time-span')} note="Work spread across sittings is hard to fake." info="How many distinct days the work spanned (from Google Docs revision history when available). Real writing tends to happen across multiple sittings, which is hard to fake in one go." />
    </div>
  );
}

/**
 * Shared: revision-analysis charts, organized + enlarged, meant for the bottom of
 * the report. Each chart gets a title + a plain caption that says what it answers,
 * and the burst terminology is spelled out (a "burst" = one run of continuous typing)
 * so "edit events" vs "typing bursts" is no longer a mystery.
 */
function RevisionCharts({ proof }: { proof: ExtensionProof }) {
  const rev = proof.revision || null;
  if (!rev || rev.editCount === 0 || !rev.timeline || rev.timeline.length === 0) return null;
  return (
    <div style={styles.card}>
      <div style={styles.signalHead}>Revision analysis</div>

      <div style={{ marginTop: 8 }}>
        <div style={styles.chartTitle}>How the document grew</div>
        <p style={styles.chartCaption}>Did it build up steadily, or appear in sudden blocks? Green = typed, amber = pasted in.</p>
        <WritingTimelineChart timeline={rev.timeline} docs={proof.docsRevision} />
      </div>

      <div style={{ marginTop: 22 }}>
        <div style={styles.chartTitle}>When the bursts happened</div>
        <p style={styles.chartCaption}>Each writing burst (one unbroken run of typing; a pause &gt; 2s starts a new one) on a real time axis across every session — empty gaps are time away from the document, tall amber bars are pasted blocks.</p>
        <BurstChart timeline={rev.timeline} byTime />
      </div>

      <div style={{ marginTop: 16 }}>
        <Row k="Typing bursts" v={`${rev.typedEdits} runs of continuous typing`} />
        {rev.pasteEdits > 0 && <Row k="Paste insertions" v={`${rev.pasteEdits} pasted in from elsewhere`} />}
      </div>
    </div>
  );
}

/** Evidence card for Version B: plain label, strength bar, value, one-line context. */
function EvidenceCard({ label, value, score, note, info }: { label: string; value: string; score: number; note: string; info?: string }) {
  return (
    <div style={styles.card}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 8 }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 14, fontWeight: 700 }}>
          {label}
          {info && <InfoDot text={info} />}
        </span>
        <span style={{ fontSize: 13, fontWeight: 700, fontFamily: 'ui-monospace, Menlo, monospace' }}>{value}</span>
      </div>
      <Blocks score={score} />
      <p style={{ ...styles.muted, margin: '8px 0 0' }}>{note}</p>
    </div>
  );
}

/**
 * Document-growth chart: how the piece was written, in order. X spans the real
 * editing date range (from Google Docs revision history when available); Y is the
 * cumulative size of the document as each edit lands. Typed work rises in a gentle
 * green slope; pasted blocks show as amber vertical cliffs, the visual signature
 * of text dropped in rather than written. Pure inline SVG, no chart library.
 */
function WritingTimelineChart({
  timeline,
  docs,
}: {
  timeline: { type: 'type' | 'paste'; chars: number; origin?: PasteOrigin; t?: number }[];
  docs?: ExtensionProof['docsRevision'];
}) {
  const W = 320, H = 176, padL = 6, padR = 6, padT = 12, padB = 24;
  const innerW = W - padL - padR, innerH = H - padT - padB;

  // Cumulative document size, seeded with a 0 baseline so the curve starts at the floor.
  const cum: number[] = [0];
  for (const e of timeline) cum.push(cum[cum.length - 1] + Math.max(0, e.chars));
  const total = cum[cum.length - 1] || 1;
  const n = cum.length;

  // Real time axis: place each point at its wall-clock timestamp (stitched across
  // all sessions) when bursts carry one; fall back to even index spacing otherwise.
  const hasTime = timeline.length > 0 && timeline.every((e) => typeof e.t === 'number');
  const ts = timeline.map((e) => e.t as number);
  const tMin = hasTime ? Math.min(...ts) : 0;
  const tMax = hasTime ? Math.max(...ts) : 1;
  const tSpan = tMax - tMin || 1;
  const x = (i: number) => {
    if (!hasTime) return padL + (n <= 1 ? 0 : (i / (n - 1)) * innerW);
    const tt = i === 0 ? tMin : ts[i - 1];
    return padL + ((tt - tMin) / tSpan) * innerW;
  };
  const y = (v: number) => padT + innerH - (v / total) * innerH;

  // Color by provenance: typed = green slope; EXTERNAL paste = amber cliff (the
  // signal); within-doc move = blue; cited quote = purple. Only amber is a concern.
  const TYPE = '#6ee7b7', EXTERNAL = '#fbbf24', MOVE = '#60a5fa', CITED = '#a78bfa';
  const segColor = (e: { type: string; origin?: PasteOrigin }) =>
    e.type !== 'paste' ? TYPE
      : e.origin === 'internal_move' ? MOVE
      : e.origin === 'cited_source' ? CITED
      : EXTERNAL;
  const segments = timeline.map((e, i) => ({
    x1: x(i), y1: y(cum[i]), x2: x(i + 1), y2: y(cum[i + 1]),
    paste: e.type === 'paste',
    external: e.type === 'paste' && (e.origin === 'external' || e.origin == null),
    color: segColor(e),
  }));
  const areaPts = cum.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  const baseY = y(0);
  const areaPath = `${padL},${baseY} ${areaPts} ${x(n - 1).toFixed(1)},${baseY}`;

  const fmtDate = (ms?: number | null) => (ms ? new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : null);
  const startLabel = (hasTime ? fmtDate(tMin) : fmtDate(docs?.firstModified)) || 'start';
  const endLabel = (hasTime ? fmtDate(tMax) : fmtDate(docs?.lastModified)) || 'finish';

  return (
    <div style={{ margin: '4px 0 12px' }}>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ display: 'block' }}>
        <defs>
          <linearGradient id="wtGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="rgba(110,231,183,0.28)" />
            <stop offset="100%" stopColor="rgba(110,231,183,0.02)" />
          </linearGradient>
        </defs>
        <polygon points={areaPath} fill="url(#wtGrad)" />
        {segments.map((s, i) => (
          <line
            key={i}
            x1={s.x1} y1={s.y1} x2={s.x2} y2={s.y2}
            stroke={s.color}
            strokeWidth={s.paste ? 2.5 : 1.8}
            strokeLinecap="round"
          />
        ))}
        {segments.filter((s) => s.paste).map((s, i) => (
          <circle key={`p${i}`} cx={s.x2} cy={s.y2} r={2.6} fill={s.color} />
        ))}
        <line x1={padL} y1={baseY} x2={W - padR} y2={baseY} stroke="currentColor" strokeOpacity={0.12} strokeWidth={1} />
        <text x={padL} y={H - 6} fill="currentColor" opacity={0.55} fontSize={9}>{startLabel}</text>
        <text x={W - padR} y={H - 6} fill="currentColor" opacity={0.55} fontSize={9} textAnchor="end">{endLabel}</text>
        <text x={padL} y={padT + 2} fill="currentColor" opacity={0.45} fontSize={9}>{total.toLocaleString()} chars</text>
      </svg>
      <div style={{ ...styles.scoreRow, flexWrap: 'wrap', gap: 8 }}>
        <span><span style={{ color: '#6ee7b7' }}>●</span> typed</span>
        <span><span style={{ color: '#fbbf24' }}>●</span> pasted in (cliffs)</span>
        {segments.some((s) => s.color === '#60a5fa') && <span><span style={{ color: '#60a5fa' }}>●</span> moved</span>}
        {segments.some((s) => s.color === '#a78bfa') && <span><span style={{ color: '#a78bfa' }}>●</span> quoted</span>}
      </div>
    </div>
  );
}

/**
 * Burst graph, one bar per edit in the writing timeline, height ∝ characters in
 * that burst. Typed bursts are green; pastes show in their provenance color (amber
 * = external, the signal). Where the cumulative chart shows *how much* was written
 * over time, this shows the *rhythm*: a wall of even green bars (steady typing) vs.
 * one lone amber tower (a block dropped in). Aggregated across all sessions. Pure
 * inline SVG, no chart library.
 */
function BurstChart({
  timeline,
  byTime = false,
}: {
  timeline: { type: 'type' | 'paste'; chars: number; origin?: PasteOrigin; t?: number }[];
  byTime?: boolean;
}) {
  const W = 320, H = 132, padT = 10, padB = 18, padL = 6, padR = 6;
  const innerW = W - padL - padR, innerH = H - padT - padB;
  const n = timeline.length;
  const max = Math.max(1, ...timeline.map((e) => e.chars));

  // Two modes from the same data: byTime=false → even bars in burst order (compare
  // sizes); byTime=true → each burst at its real wall-clock time across all sessions,
  // so gaps between days/sittings show as empty stretches (the cadence of the work).
  // Time mode needs stamped bursts; older untimestamped payloads fall back to order.
  const hasTime = n > 0 && timeline.every((e) => typeof e.t === 'number');
  const useTime = byTime && hasTime;
  const ts = timeline.map((e) => e.t as number);
  const tMin = useTime ? Math.min(...ts) : 0;
  const tMax = useTime ? Math.max(...ts) : 1;
  const tSpan = tMax - tMin || 1;
  const idxGap = n > 60 ? 0.5 : 2;
  const idxBw = n > 0 ? Math.max(1, (innerW - idxGap * (n - 1)) / n) : innerW;
  const bw = useTime ? Math.max(1.2, Math.min(idxBw, 4)) : idxBw;
  const xAt = (i: number) =>
    useTime ? padL + ((ts[i] - tMin) / tSpan) * (innerW - bw)
            : padL + i * (idxBw + idxGap);

  const TYPE = '#6ee7b7', EXTERNAL = '#fbbf24', MOVE = '#60a5fa', CITED = '#a78bfa';
  const color = (e: { type: string; origin?: PasteOrigin }) =>
    e.type !== 'paste' ? TYPE
      : e.origin === 'internal_move' ? MOVE
      : e.origin === 'cited_source' ? CITED
      : EXTERNAL;
  const fmtDate = (ms: number) => new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

  return (
    <div style={{ margin: '4px 0 12px' }}>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ display: 'block' }}>
        {timeline.map((e, i) => {
          const h = Math.max(2, (e.chars / max) * innerH);
          const x = xAt(i);
          const y = padT + innerH - h;
          return <rect key={i} x={x.toFixed(1)} y={y.toFixed(1)} width={bw.toFixed(1)} height={h.toFixed(1)} rx={1} fill={color(e)} />;
        })}
        <line x1={padL} y1={padT + innerH} x2={W - padR} y2={padT + innerH} stroke="currentColor" strokeOpacity={0.12} strokeWidth={1} />
        {useTime && (
          <>
            <text x={padL} y={H - 4} fill="currentColor" opacity={0.55} fontSize={9}>{fmtDate(tMin)}</text>
            <text x={W - padR} y={H - 4} fill="currentColor" opacity={0.55} fontSize={9} textAnchor="end">{fmtDate(tMax)}</text>
          </>
        )}
      </svg>
      {/* Captions live in normal HTML, not as SVG text (which scales with the chart
          width and balloons). */}
      <div style={{ ...styles.scoreRow, gap: 8 }}>
        <span>{n} {n === 1 ? 'burst' : 'bursts'} · largest {max.toLocaleString()} chars</span>
        {byTime && !hasTime && <span style={{ opacity: 0.75, textAlign: 'right' }}>real-time view fills in after your next capture</span>}
      </div>
    </div>
  );
}

function alignTagStyle(a: NonNullable<RubricRow['alignment']>): React.CSSProperties {
  const map = {
    strong: { color: '#6ee7b7', border: '1px solid rgba(110,231,183,0.5)' },
    partial: { color: '#a7f3d0', border: '1px solid rgba(167,243,208,0.5)' },
    weak: { color: '#fbbf24', border: '1px solid rgba(251,191,36,0.5)' },
    unclear: { color: '#9ca3af', border: '1px solid rgba(156,163,175,0.5)' },
  } as const;
  return map[a];
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
  // Faint cyan "ink in water" wash behind the top of the report — the brand motif
  // as a pure background gradient (always paints behind content, no z-index games).
  wrap: {
    maxWidth: 'min(1040px, 94vw)', margin: '32px auto', padding: '0 20px', color: 'inherit',
    backgroundImage: 'radial-gradient(ellipse 46% 30% at 82% 4%, rgba(0,180,216,0.10), rgba(0,200,230,0) 70%)',
    backgroundRepeat: 'no-repeat',
  },
  // ── Branding: eyebrow kicker + proof sign-off ──
  kicker: { display: 'inline-flex', alignItems: 'center', gap: 7, marginBottom: 7 },
  kickerText: { fontSize: 11, fontWeight: 700, letterSpacing: '0.18em', textTransform: 'uppercase', color: 'var(--hi-cyan-ink, #075985)' },
  signoff: { display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'center', gap: '6px 9px', marginTop: 30, paddingTop: 18, borderTop: '1px solid rgba(15,23,42,0.08)', fontSize: 12 },
  signoffMark: { display: 'inline-flex', alignItems: 'center', gap: 6 },
  signoffBrand: { fontWeight: 700, letterSpacing: '0.02em', color: 'inherit', opacity: 0.85 },
  signoffDot: { opacity: 0.35, userSelect: 'none' },
  signoffPowered: { opacity: 0.6 },
  signoffWorld: { display: 'inline-flex', alignItems: 'center', gap: 5, textDecoration: 'none', color: 'inherit', fontWeight: 600 },
  signoffWorldWord: { textTransform: 'lowercase', letterSpacing: '-0.01em' },
  // Informational cards flow into as many ~330px columns as fit (3 on desktop,
  // 2 on a tablet, 1 on a phone), responsive with no media queries.
  bodyGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(330px, 1fr))', gap: 14, alignItems: 'start', margin: '12px 0' },
  h1: { fontSize: 20, marginBottom: 6 },
  muted: { fontSize: 13, opacity: 0.7, margin: '6px 0' },
  error: { fontSize: 13, color: '#f87171', margin: '8px 0' },
  tag: { fontSize: 9, textTransform: 'uppercase', letterSpacing: 0.5, opacity: 0.6, border: '1px solid currentColor', borderRadius: 4, padding: '1px 4px', marginLeft: 4 },
  card: { border: '1px solid rgba(255,255,255,0.14)', borderRadius: 10, padding: 14, margin: '12px 0', background: 'rgba(255,255,255,0.03)' },
  heroCard: { border: '1.5px solid', borderRadius: 14, padding: 18, margin: '16px 0', background: 'rgba(255,255,255,0.04)' },
  heroRow: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 14, margin: '16px 0' },
  bandPill: { display: 'inline-block', marginTop: 10, fontSize: 12, fontWeight: 650, border: '1px solid', borderRadius: 999, padding: '2px 10px' },
  reasonLine: { fontSize: 12.5, opacity: 0.78, margin: '10px 0 0', lineHeight: 1.45 },
  seeWhy: { width: '100%', maxWidth: 240, margin: '2px auto 10px', display: 'block', padding: '8px 12px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.18)', background: 'rgba(255,255,255,0.04)', color: 'inherit', fontSize: 13, fontWeight: 600, cursor: 'pointer' },
  heroHead: { display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 12 },
  heroLabel: { fontSize: 13, fontWeight: 600, opacity: 0.85 },
  heroNum: { fontSize: 42, fontWeight: 750, lineHeight: 1, fontVariantNumeric: 'tabular-nums' },
  signalHead: { fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.7, fontWeight: 700, opacity: 0.88, marginBottom: 12 },
  infoDot: { display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 15, height: 15, borderRadius: '50%', border: '1px solid rgba(255,255,255,0.75)', background: 'rgba(255,255,255,0.08)', color: 'rgba(255,255,255,0.9)', fontSize: 10, fontWeight: 700, fontStyle: 'italic', fontFamily: 'Georgia, serif', lineHeight: 1, opacity: 0.9, cursor: 'help', outline: 'none' },
  infoTip: { position: 'absolute', bottom: 'calc(100% + 8px)', left: '50%', transform: 'translateX(-50%)', width: 220, padding: '9px 11px', borderRadius: 8, background: 'rgba(18,18,22,0.98)', border: '1px solid rgba(255,255,255,0.18)', color: '#fff', fontSize: 12, fontWeight: 400, fontStyle: 'normal', textTransform: 'none', letterSpacing: 0, lineHeight: 1.45, zIndex: 30, boxShadow: '0 8px 28px rgba(0,0,0,0.45)', pointerEvents: 'none' },
  chartTitle: { fontSize: 13.5, fontWeight: 700, marginBottom: 2 },
  chartCaption: { fontSize: 11.5, opacity: 0.65, margin: '0 0 6px', lineHeight: 1.4 },
  receiptLabel: { fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5, opacity: 0.6, marginBottom: 4 },
  receiptHash: { fontFamily: 'ui-monospace, Menlo, monospace', fontSize: 12.5, wordBreak: 'break-all', userSelect: 'all', lineHeight: 1.5 },
  receiptBtn: { display: 'inline-block', padding: '8px 14px', borderRadius: 8, border: '1px solid #6ee7b7', background: 'rgba(110,231,183,0.12)', color: '#6ee7b7', fontSize: 13, fontWeight: 650, cursor: 'pointer', textDecoration: 'none' },
  signalList: { marginTop: 16, display: 'flex', flexDirection: 'column', gap: 16 },
  signal: { display: 'flex', flexDirection: 'column', gap: 6, borderLeft: '2px solid rgba(110,231,183,0.45)', paddingLeft: 11 },
  signalTop: { display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 10 },
  signalLabel: { fontSize: 14, fontWeight: 700, letterSpacing: 0.15 },
  signalDetail: { fontSize: 12.5, fontWeight: 700, opacity: 0.95, fontFamily: 'ui-monospace, Menlo, monospace', textAlign: 'right' },
  signalBarWrap: { height: 5, borderRadius: 999, background: 'rgba(255,255,255,0.1)', overflow: 'hidden' },
  signalBarFill: { height: '100%', borderRadius: 999, background: 'rgba(255,255,255,0.55)', transition: 'width 0.5s' },
  signalBlurb: { fontSize: 11.5, opacity: 0.7, margin: '2px 0 0', lineHeight: 1.45 },
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
  primary: { width: '100%', maxWidth: 420, margin: '0 auto', display: 'block', padding: '11px 14px', borderRadius: 8, border: 'none', background: '#6ee7b7', color: '#0b0d10', fontWeight: 650, fontSize: 14, cursor: 'pointer' },
  link: { color: '#6ee7b7', fontSize: 13, textDecoration: 'none' },
  sec: { fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.6, opacity: 0.6, marginBottom: 8 },
  timeline: { display: 'flex', flexWrap: 'wrap', gap: 3, marginTop: 10 },
  chip: { fontSize: 10, padding: '2px 6px', borderRadius: 4, whiteSpace: 'nowrap', border: '1px solid rgba(255,255,255,0.12)' },
  chipType: { background: 'rgba(110,231,183,0.14)', color: '#6ee7b7' },
  chipPaste: { background: 'rgba(251,191,36,0.16)', color: '#fbbf24' },
  chipMove: { background: 'rgba(96,165,250,0.16)', color: '#60a5fa' },
  chipCited: { background: 'rgba(167,139,250,0.16)', color: '#a78bfa' },
  flagList: { display: 'flex', flexDirection: 'column', gap: 8, marginTop: 4 },
  flag: { display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: 12.5, lineHeight: 1.4 },
  flagDot: { fontWeight: 700, width: 14, flexShrink: 0, textAlign: 'center' },
  flagText: { opacity: 0.85 },
  ghostBtn: { width: '100%', padding: '4px 0', background: 'none', border: 'none', color: '#6ee7b7', fontSize: 13, fontWeight: 600, cursor: 'pointer', textAlign: 'left' },
  textarea: { width: '100%', boxSizing: 'border-box', marginTop: 8, padding: 10, borderRadius: 8, border: '1px solid rgba(255,255,255,0.18)', background: 'rgba(0,0,0,0.25)', color: 'inherit', fontSize: 13, fontFamily: 'inherit', resize: 'vertical' },
  input: { width: '100%', boxSizing: 'border-box', marginTop: 8, padding: 10, borderRadius: 8, border: '1px solid rgba(255,255,255,0.18)', background: 'rgba(0,0,0,0.25)', color: 'inherit', fontSize: 13, fontFamily: 'inherit' },
  rubricRow: { padding: '8px 0', borderTop: '1px solid rgba(255,255,255,0.08)' },
  rubricCrit: { fontSize: 13, fontWeight: 600, marginBottom: 2, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  alignTag: { fontSize: 9, textTransform: 'uppercase', letterSpacing: 0.5, borderRadius: 4, padding: '1px 5px' },
  rubricNote: { fontSize: 12, opacity: 0.7, lineHeight: 1.4 },
};
