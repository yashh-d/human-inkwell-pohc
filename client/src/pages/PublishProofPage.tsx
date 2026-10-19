import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useLogin, useWallets, usePrivy, useCreateWallet } from '@privy-io/react-auth';
import { ethers } from 'ethers';
import { blockchainService } from '../blockchain';
import { pushLedgerIndexAfterOnChainSuccess } from '../ledgerSupabase';
import { useViewerAddress } from '../hooks/useViewerAddress';
import { rememberMiniKitWallet } from '../utils/miniKitWallet';
import {
  ExtensionProof, PasteOrigin, ScoreBands,
  DEFAULT_BANDS, PROOF_KEY, loadProof, short, fmtMs,
  computeAiScore, pasteBreakdown, computeAuthorshipScore,
  processBand, reasonLine, computeIntegrity, INTEGRITY_INFO,
} from "../lib/authorship";
import { detectAi, AiResult } from '../lib/aiDetector';
import { compareToFingerprint, storedAiResult, DocumentMatch } from '../lib/contentMatch';
import { aiCheckStillRunning, type PasteEvent } from '../submissionsApi';
import { computeReceipts, fmtDuration } from '../lib/receipts';
import { publishCreatorPost } from '../creatorSupabase';
import StudentSubmitPanel from '../components/StudentSubmitPanel';

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

/** Publish intent, held across a sign-in that navigates the page away and back. */
const PENDING_PUBLISH_KEY = 'humanink_pending_publish';
/** Long enough to cover a Google round trip, short enough that a forgotten tab
 *  can never resume a publish the student has moved on from. */
const PENDING_PUBLISH_TTL_MS = 10 * 60 * 1000;

function readPendingPublish(): boolean {
  try {
    const raw = sessionStorage.getItem(PENDING_PUBLISH_KEY);
    if (!raw) return false;
    const at = Number(raw);
    if (!Number.isFinite(at) || Date.now() - at > PENDING_PUBLISH_TTL_MS) {
      sessionStorage.removeItem(PENDING_PUBLISH_KEY);
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

function writePendingPublish(pending: boolean): void {
  try {
    if (pending) sessionStorage.setItem(PENDING_PUBLISH_KEY, String(Date.now()));
    else sessionStorage.removeItem(PENDING_PUBLISH_KEY);
  } catch {
    /* private mode — the in-page flow still works, only the resume is lost */
  }
}

type SubmitState =
  | { phase: 'idle' }
  | { phase: 'submitting' }
  | { phase: 'success'; result: any }
  | { phase: 'error'; message: string };

export default function PublishProofPage(
  {
    variant = 'student',
    injectedProof,
    injectedPasteEvents,
    previewOnly = false,
    onPreviewVerify,
    reportOnly = false,
    publishedAt,
  }: {
    variant?: 'student' | 'creator';
    injectedProof?: ExtensionProof;
    // Professor-only paste content (from /api/submission), matched onto the paste
    // entries in the revision charts so a hover reveals what was pasted in.
    injectedPasteEvents?: PasteEvent[];
    // Preview mode (the /write demo): render the exact same report, but swap the
    // real "publish" action for a "verify with World ID" call-to-action and drop
    // the A/B design toggle. Nothing is signed or written on-chain.
    previewOnly?: boolean;
    onPreviewVerify?: () => void;
    // Report-only mode (the professor's /s/<slug> detailed view): render the full
    // scores + evidence from an injected proof, with the detail expanded and no
    // publish/verify action. This is the gated view only professors reach.
    reportOnly?: boolean;
    // When the submission was stored (professor view). Bounds how long a queued
    // AI check is shown as "running" before the card says it didn't complete.
    publishedAt?: string | null;
  } = {},
) {
  const isCreator = variant === 'creator';
  // The detailed evidence breakdown is professor-facing: shown for the creator
  // report, the /write preview, and the professor's report-only view — but hidden
  // from a student's own publish page (they see only the two headline scores).
  const showDetail = isCreator || previewOnly || reportOnly;
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
  // "I pressed Publish" survives a full page navigation. Privy's OAuth path can
  // hand the browser to Google and back, which unmounts this page and would
  // otherwise drop the intent — the student returned signed in, to a button they
  // had to press a second time. Restored on mount so the publish just continues.
  // sessionStorage (per tab) plus a short expiry, so a stale flag can never make
  // a later visit publish something on its own.
  const [pendingPublish, setPendingPublish] = useState<boolean>(() => readPendingPublish());
  useEffect(() => { writePendingPublish(pendingPublish); }, [pendingPublish]);
  // Students name themselves (and optionally pick an assignment) BEFORE publishing;
  // the publish button stays disabled until the required name is filled in.
  const [studentReady, setStudentReady] = useState(false);
  // A/B design toggle: A is the current report; B is the evidence-first redesign.
  // The original report (Version A: Process Score + AI% + typing stats + charts)
  // is the one and only design; the A/B toggle is gone. The `as` keeps the union
  // type so the dormant B branch below still compiles (TS would otherwise narrow
  // the const to 'a' and flag the comparison) until B is excised entirely.
  const view = 'a' as 'a' | 'b';
  // Creator variant: opt into HI Feed BEFORE publishing, so the on-chain write
  // and the feed post happen from one action (the feed post fires automatically
  // once the tx confirms). Identity comes from the signed-in Google account — no
  // username to type.
  const { user, authenticated } = usePrivy();
  const { createWallet } = useCreateWallet();
  const creatingWalletRef = useRef(false);
  const [feedOptIn, setFeedOptIn] = useState(true);
  const [feedState, setFeedState] = useState<'idle' | 'saving' | 'done' | 'error'>('idle');
  const [feedMsg, setFeedMsg] = useState('');

  // Sign-in for publishing runs through Privy's in-page modal, NOT the headless
  // OAuth redirect. The redirect handed the browser to Google and back, which
  // unmounted this page and took the student's typed name and assignment pick with
  // it — so the publish that resumed would have been an unattached one. The modal
  // keeps the page mounted: the student signs in, the effects below see identity
  // go ready, and the publish they already asked for finishes on its own.
  const { login } = useLogin({
    onComplete: () => { /* pendingPublish + the wallet effect carry it from here */ },
    onError: (err) => {
      setPendingPublish(false);
      setAuthError(typeof err === 'string' ? err : 'Google sign-in failed.');
    },
  });

  // AI probability. Starts from the instant heuristic so the card never blocks,
  // then upgrades in place to the real detector's result (source: 'model') once
  // the worker responds. Falls back to the heuristic if the detector is down.
  // A stored proof carries the detector's publish-time result and no text, so it
  // shows that result rather than re-scoring (storedAiResult). A fresh hand-off
  // starts from the heuristic and upgrades below once the detector answers.
  const baseAi = useMemo<AiResult | null>(
    () => (proof ? (storedAiResult(proof) ?? { ...computeAiScore(proof.metrics || {}), source: 'simulated' }) : null),
    [proof],
  );
  const [ai, setAi] = useState<AiResult | null>(baseAi);
  const [aiPending, setAiPending] = useState(false);
  useEffect(() => { setAi(baseAi); }, [baseAi]);
  // Where the AI number is shown live vs. computed later on the server:
  //  - student publish page: NO in-page detection and NO number. The check runs once
  //    on the server at submit (StudentSubmitPanel → /api/submission-ai) and is a
  //    professor-side artifact. That keeps the GPU cold start off the student's path
  //    and spends a GPU call only when a submission actually exists.
  //  - creator Slop Score and the /write preview: live detection, number shown.
  //  - professor report: the stored proof has no text, so this is a no-op and
  //    storedAiResult replays the server-stored number (or the card shows "pending").
  const isStudentFlow = !isCreator && !reportOnly && !previewOnly;
  const runLiveDetect = isCreator || previewOnly;
  const NEUTRAL = '#94a3b8';
  useEffect(() => {
    if (!proof || !runLiveDetect) return;
    const hasText = !!(proof.text && proof.text.trim());
    if (!hasText) return; // no text to score (Docs / old payload) → keep heuristic
    let alive = true;
    setAiPending(true);
    detectAi({ text: proof.text, contentHash: proof.contentHash, metrics: proof.metrics || {} })
      .then((r) => { if (alive) setAi(r); })
      .finally(() => { if (alive) setAiPending(false); });
    return () => { alive = false; };
  }, [proof, runLiveDetect]);
  const authorship = useMemo(() => (proof ? computeAuthorshipScore(proof) : null), [proof]);
  const integrity = useMemo(() => (proof ? computeIntegrity(proof) : null), [proof]);

  // F2: evidence collapsed by default; score-bands are server-tunable (no deploy).
  const [showEvidence, setShowEvidence] = useState<boolean>(!!reportOnly);
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

  // Signed in with Google, but with no embedded wallet yet ('no-wallet').
  //
  // This is the state that used to bounce the user through Google sign-in over and
  // over: they were ALREADY authenticated, so each OAuth round trip returned almost
  // instantly and changed nothing, while the thing actually missing was the WALLET.
  // (An account can end up here whenever Privy's create-on-login didn't run for it —
  // it can't prompt while `showWalletUIs: false`, and accounts that predate the
  // config never had it run at all.) Create the wallet once; the effect above then
  // publishes on its own as soon as `wallets` populates. The ref guard matters:
  // without it every re-render while pending would fire another createWallet.
  useEffect(() => {
    if (SIMULATE || !pendingPublish) return;
    if (identity.status !== 'no-wallet' || !authenticated) return;
    if (creatingWalletRef.current) return;
    // The account may already OWN an embedded wallet that just hasn't connected in
    // this session yet — useWallets() is empty for a moment after a cold load.
    // Creating a second one throws "user already has a wallet", so wait instead:
    // when it connects, the publish effect above fires on its own.
    const ownsEmbedded = (user?.linkedAccounts || []).some(
      (a: any) => a?.type === 'wallet' && a?.walletClientType === 'privy'
    );
    if (ownsEmbedded) return;
    creatingWalletRef.current = true;
    createWallet()
      .catch((e) => {
        setPendingPublish(false);
        setAuthError(e instanceof Error ? e.message : 'Could not create your signing wallet.');
      })
      .finally(() => { creatingWalletRef.current = false; });
  }, [pendingPublish, identity.status, authenticated, user, createWallet]);

  const handlePrimary = useCallback(() => {
    setAuthError(null);
    if (SIMULATE) { simulatePublish(); return; }
    if (identity.status === 'ready') doPublish();
    else if (identity.status === 'needs-auth') { setPendingPublish(true); identity.authenticate(); }
    else if (identity.status === 'loading' || authenticated) {
      // Either Privy is still booting, or we're already signed in and only the
      // wallet is missing. Another Google round trip fixes neither — sending one
      // is exactly the redirect loop. Just mark the publish pending and let the
      // effects above finish the job.
      setPendingPublish(true);
    } else {
      setPendingPublish(true);
      try { login(); }
      catch (e) { setPendingPublish(false); setAuthError(e instanceof Error ? e.message : 'Could not start sign-in.'); }
    }
  }, [identity, authenticated, doPublish, login, simulatePublish]);

  // Identity for the feed, from the signed-in Google account (Privy) → the proof.
  const feedEmail: string = (user?.email?.address as string)
    || ((user as any)?.google?.email as string)
    || proof?.email
    || '';
  const feedUsername = feedEmail ? feedEmail.split('@')[0] : '';

  // Record the piece to the creator's profile once the on-chain write confirms.
  // Always runs for creators (their body of work); the feedOptIn checkbox only
  // sets is_public (whether it also shows on the public HI Feed). Fires once.
  useEffect(() => {
    if (!isCreator || feedState !== 'idle') return;
    if (submit.phase !== 'success') return;
    const result: any = submit.result;
    if (!result || result.simulated || !proof || !authorship || !ai) return;
    const entryId = typeof result.entryId === 'number' ? result.entryId : undefined;
    const tx: string | undefined = result.transactionHash;
    const author = result.walletAddress || (identity.status === 'ready' ? identity.address : '');
    if (typeof entryId !== 'number' || !tx || !author) return;
    setFeedState('saving');
    const mm = proof.metrics || {};
    const r = computeReceipts(proof);
    publishCreatorPost({
      chain_id: CHAIN_ID,
      contract_address: CONTRACT_ADDRESS,
      entry_id: entryId,
      transaction_hash: tx,
      content_hash: proof.contentHash,
      author_address: author,
      title: proof.docTitle || undefined,
      content: proof.text || undefined,
      grind_score: authorship.score,
      ai_slop: ai.ai,
      human_pct: ai.human,
      word_count: r.wordsPublished,
      revisions: r.revisions,
      edit_days: r.editDays,
      minutes: Math.round((mm.elapsedMs || 0) / 60000),
      // Receipts (the creator surfaces read these).
      active_seconds: r.activeSeconds,
      sessions: r.sessions,
      keystrokes: r.keystrokes,
      words_typed: r.wordsTyped,
      words_published: r.wordsPublished,
      kill_ratio: r.killRatio,
      wpm: r.wpm,
      wpm_series: r.wpmSeries,
      is_public: feedOptIn,
      display_name: feedUsername || undefined,
      handle: feedUsername ? feedUsername.toLowerCase().replace(/[^a-z0-9_]/g, '') : undefined,
    }).then((res) => {
      if (res.ok) { setFeedState('done'); setFeedMsg(''); }
      else { setFeedState('error'); setFeedMsg(res.error || 'Could not save this piece.'); }
    });
  }, [isCreator, feedOptIn, feedState, submit, proof, authorship, ai, identity, feedUsername]);

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
  // "Publishing…" was shown for BOTH the on-chain write and the wait for an
  // identity, so a publish stuck waiting for a wallet looked like a publish in
  // progress and gave the user nothing to act on. Name the real stage.
  const busyLabel =
    submit.phase !== 'submitting' && !SIMULATE && pendingPublish && identity.status !== 'ready'
      ? 'Preparing your wallet…'
      : 'Publishing…';
  const band = processBand(authorship.score, bands);
  const reason = reasonLine(proof, authorship.score);
  const authorAddress = submit.phase === 'success'
    ? (submit.result?.walletAddress || (identity.status === 'ready' ? identity.address : ''))
    : '';
  const successEntryId = submit.phase === 'success' && typeof submit.result?.entryId === 'number'
    ? (submit.result.entryId as number) : undefined;
  const successResult = submit.phase === 'success' ? submit.result : undefined;

  if (view === 'b') {
    return (
      <PublishVersionB
        proof={proof} ai={ai} authorship={authorship} integrity={integrity} bands={bands}
        success={success} busy={busy} busyLabel={busyLabel} submit={submit} onPublish={handlePrimary}
        authError={authError} identityAuthError={identity.authError}
        isCreator={isCreator} authorAddress={authorAddress}
      />
    );
  }

  return (
    <div style={styles.wrap}>
      <h1 style={styles.h1}>{success ? '✓ Proof published' : 'Proof of human writing'}</h1>
      <p style={styles.muted}>
        {previewOnly
          ? 'Preview of the proof this would generate — computed on your device'
          : isCreator
          ? 'Written in the Human Ink editor'
          : `Captured by the Human Ink extension${proof.context === 'google-docs' ? ' from Google Docs' : ''}`}
        {!previewOnly && proof.email ? ` · ${proof.email}` : ''}.{!previewOnly && SIMULATE ? ' Demo, simulated on-chain write.' : ''}
      </p>

      {/* F2, two DECOUPLED metrics side by side. The Process Score is our own
          integrity measure; the AI probability is a separate post-hoc reference.
          They are never blended (a detector false-positive can't move the score). */}
      {isCreator ? (
        <ReceiptsHero proof={proof} verified={success} />
      ) : (
      <div style={styles.heroRow}>
        <div style={{ ...styles.heroCard, borderColor: band.color, margin: 0 }}>
          <div style={styles.heroHead}>
            <span style={styles.heroLabel}>{scoreLabel}</span>
            <span style={{ ...styles.heroNum, color: band.color }}>{authorship.score}</span>
          </div>
          <div style={styles.barWrap}>
            <div style={{ ...styles.barFill, width: `${authorship.score}%`, background: band.color }} />
          </div>
          <p style={styles.reasonLine}>{reason}</p>
        </div>
        {isStudentFlow ? (
          // Student: no number. The check runs on the server at submit and is shown to
          // the professor only — privacy, and it keeps the detector's cold start off the
          // student's path entirely.
          <div style={{ ...styles.heroCard, borderColor: NEUTRAL, margin: 0 }}>
            <div style={styles.heroHead}>
              <span style={styles.heroLabel}>AI check</span>
              <span style={{ ...styles.heroNum, color: NEUTRAL }}>✓</span>
            </div>
            <p style={styles.reasonLine}>
              Runs when you submit and is shared with your professor. A separate reference, not part of the {scoreLabel}.
            </p>
          </div>
        ) : reportOnly && ai.source !== 'model' ? (
          // Professor, no stored model result. Say exactly which case this is rather
          // than dressing the heuristic up as a number or showing an eternal "pending":
          // a check that was started and is still inside its window is pending (the
          // report page re-fetches until it lands); everything else is final.
          (() => {
            const status = proof.aiCheck;
            const running = status === 'queued' && aiCheckStillRunning(publishedAt);
            const tag = running ? 'pending' : status === 'queued' ? 'incomplete' : 'not run';
            const copy = running
              ? `The AI check is still running. It appears here as soon as it finishes — a parallel reference, not part of the ${scoreLabel}.`
              : status === 'queued'
              ? `The AI check was started but did not finish, so there is no result for this submission. A parallel reference, not part of the ${scoreLabel}.`
              : status === 'unavailable'
              ? `No text was captured with this submission, so the AI check could not run. A parallel reference, not part of the ${scoreLabel}.`
              : `This was published before the AI check existed, so it was not run. A parallel reference, not part of the ${scoreLabel}.`;
            return (
              <div style={{ ...styles.heroCard, borderColor: NEUTRAL, margin: 0 }}>
                <div style={styles.heroHead}>
                  <span style={styles.heroLabel}>{aiLabel}<span style={styles.tag}>{tag}</span></span>
                  <span style={{ ...styles.heroNum, color: NEUTRAL }}>—</span>
                </div>
                <p style={styles.reasonLine}>{copy}</p>
              </div>
            );
          })()
        ) : (
        <div style={{ ...styles.heroCard, borderColor: ai.color, margin: 0 }}>
          <div style={styles.heroHead}>
            <span style={styles.heroLabel}>{aiLabel}{aiPending ? <span style={styles.tag}>analyzing…</span> : null}</span>
            <span style={{ ...styles.heroNum, color: ai.color }}>{ai.ai}%</span>
          </div>
          <div style={styles.barWrap}>
            <div style={{ ...styles.barFill, width: `${ai.ai}%`, background: ai.color }} />
          </div>
          <p style={styles.reasonLine}>
            {ai.source === 'model'
              ? `Independent post-hoc detector, a parallel reference, not part of the ${scoreLabel}.`
              : `Detector unavailable, so this is a rough heuristic estimate, not a model result. A parallel reference, not part of the ${scoreLabel}.`}
          </p>
        </div>
        )}
      </div>
      )}

      {showDetail && (
        <button style={styles.seeWhy} onClick={() => setShowEvidence((v) => !v)}>
          {showEvidence ? 'Hide evidence ▲' : 'See why ▼'}
        </button>
      )}

      {showDetail && showEvidence && (
      <>
      {/* Professor-only: paste what the student handed in, see how much of the
          proven document it contains. Nothing pasted here leaves the browser. */}
      {reportOnly && <DocumentCheck proof={proof} />}

      {/* Evidence cards, then a drop-down with the per-signal breakdown (shared with B).
          The composite-score breakdown is hidden for creators (receipts, not scores). */}
      <EvidenceCards proof={proof} authorship={authorship} />
      {!isCreator && <ScoreCalcDetails authorship={authorship} scoreLabel={scoreLabel} />}

      {/* On desktop these informational cards flow into 2–3 columns; on mobile
          they stack. Auto-fit grid → responsive without media queries. */}
      <div style={styles.bodyGrid}>
      {/* Revision authenticity, the anti-gaming check (real, always on). It reads
          the same pace/length signals the Process Score does but through a
          deduction formula, so the InfoDot is not optional: without it a reader
          has two numbers on one page and no way to tell what separates them. */}
      <div style={{ ...styles.card, borderColor: integrity.color }}>
        <div style={styles.scoreHead}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, ...styles.muted }}>
            Revision authenticity
            <InfoDot text={INTEGRITY_INFO} />
          </span>
          <span style={{ ...styles.verdict, color: integrity.color }}>{integrity.score}</span>
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
        <PasteDisclosure authorship={authorship} />
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
              v={`${fmtTipDate(proof.docsRevision.firstModified) ?? '—'} → ${fmtTipDate(proof.docsRevision.lastModified) ?? '—'}`}
            />
          )}
          <Row k="Editors" v={proof.docsRevision.authors.length ? proof.docsRevision.authors.join(', ') : '-'} />
        </div>
      )}

      {/* Tracking-off disclosure. Live keystroke capture can be toggled off; when
          it is, we say so here. This is transparency, not a loophole — the Google
          revision scan above is toggle-independent, so pasted text is still caught
          even during an off window. */}
      {proof.pause && proof.pause.everPaused && (
        <div style={{ ...styles.card, borderColor: 'var(--warn-border, #fde68a)' }}>
          <div style={styles.sec}>⚠ Live tracking was turned off</div>
          <Row k="Total time off" v={fmtMs(proof.pause.pausedMs)} />
          <Row
            k="Times toggled off"
            v={String(proof.pause.pauseCount || (proof.pause.pauses?.length ?? 0))}
          />
          {proof.pause.currentlyPaused && <Row k="Status" v="off at publish time" />}
          {Array.isArray(proof.pause.pauses) && proof.pause.pauses.length > 0 && (
            proof.pause.pauses.slice(-6).map((w, i) => (
              <Row
                key={i}
                k={`Off window ${proof.pause!.pauses.length > 6 ? proof.pause!.pauses.length - 6 + i + 1 : i + 1}`}
                v={`${new Date(w.start).toLocaleString()} → ${w.end ? new Date(w.end).toLocaleTimeString() : 'still off'} (${fmtMs(Math.max(0, (w.end || Date.now()) - w.start))})`}
              />
            ))
          )}
          <p style={{ ...styles.muted, marginTop: 6 }}>
            The Google Docs revision scan runs regardless of this toggle, so any text
            pasted while tracking was off is still recorded above.
          </p>
        </div>
      )}

      </div>{/* end bodyGrid */}

      {/* Revision-analysis charts, organized + enlarged, at the bottom. */}
      <RevisionCharts proof={proof} pasteEvents={injectedPasteEvents} />

      </>
      )}

      {reportOnly ? null : previewOnly ? (
        <>
          <button style={styles.primary} onClick={() => onPreviewVerify?.()}>
            Verify with World ID to post for real
          </button>
          <p style={{ ...styles.muted, textAlign: 'center', marginTop: 10 }}>
            This is a preview — nothing was signed or written on-chain. Verify with World ID to make it permanent.
          </p>
        </>
      ) : isCreator ? (
        success ? (
          <>
            <Receipt result={submit.result} />
            <HIFeedStatus state={feedState} msg={feedMsg} isPublic={feedOptIn} />
            {feedOptIn && feedState === 'done' && typeof successEntryId === 'number' && <CraftCardEmbed entryId={successEntryId} />}
          </>
        ) : (
          <>
            <HIFeedToggle optIn={feedOptIn} setOptIn={setFeedOptIn} username={feedUsername} />
            <button style={{ ...styles.primary, opacity: busy ? 0.6 : 1 }} disabled={busy} onClick={handlePrimary}>
              {busy ? busyLabel : SIMULATE ? 'Publish proof on-chain' : feedOptIn ? 'Continue with Google & publish to HI Feed' : 'Continue with Google & publish'}
            </button>
            {(authError || identity.authError) && <p style={styles.error}>{authError || identity.authError}</p>}
            {submit.phase === 'error' && <p style={styles.error}>{submit.message}</p>}
            <Link to="/" style={{ ...styles.link, marginTop: 14, display: 'block' }}>Cancel</Link>
          </>
        )
      ) : (
        // Student: name + (optional) assignment are gathered BEFORE publishing, so
        // one action signs in, writes on-chain, mints the share link, and drops it
        // into the professor's assignment. The panel keeps its own position in the
        // tree so the collected name/target survive the publish → success flip.
        <>
          {success && <Receipt result={submit.result} />}
          <StudentSubmitPanel
            key="student-submit"
            published={success}
            onReadyChange={setStudentReady}
            proof={proof}
            ai={ai}
            summary={{
              authorship_score: authorship.score,
              // Only a real model result is stored at creation — the heuristic is never
              // persisted as if it were one. The server fills this in via /api/submission-ai.
              ai_score: ai && ai.source === 'model' ? ai.ai : null,
              integrity_score: integrity.score,
              band: band.tone,
            }}
            onchain={{
              chain_id: CHAIN_ID,
              contract_address: CONTRACT_ADDRESS,
              entry_id: successEntryId,
              content_hash: proof.contentHash,
              transaction_hash: successResult?.transactionHash,
            }}
          />
          {!success && (
            <>
              <button
                style={{ ...styles.primary, marginTop: 16, opacity: busy || !studentReady ? 0.6 : 1 }}
                disabled={busy || !studentReady}
                onClick={handlePrimary}
              >
                {busy ? busyLabel : 'Publish'}
              </button>
              {!studentReady && (
                <p style={{ ...styles.muted, textAlign: 'center', marginTop: 8 }}>Add your name above to continue.</p>
              )}
              {(authError || identity.authError) && <p style={styles.error}>{authError || identity.authError}</p>}
              {submit.phase === 'error' && <p style={styles.error}>{submit.message}</p>}
              <Link to="/" style={{ ...styles.link, marginTop: 14, display: 'block' }}>Cancel</Link>
            </>
          )}
        </>
      )}
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

/**
 * Version B, the evidence-first redesign. Same scoring + telemetry as A; only the
 * narrative order and copy change: lead with the score and what was captured,
 * surface revision authenticity near the top, explain how the score is built, and
 * relegate the AI detector + technical hashes to small secondary/advanced areas.
 * No page in either version puts a word next to a number — the reader gets the
 * measurement and the evidence, and draws the conclusion themselves.
 */
function PublishVersionB({
  proof, ai, authorship, integrity, bands,
  success, busy, busyLabel, submit, onPublish, authError, identityAuthError,
  isCreator, authorAddress,
}: {
  proof: ExtensionProof;
  ai: AiResult;
  authorship: ReturnType<typeof computeAuthorshipScore>;
  integrity: ReturnType<typeof computeIntegrity>;
  bands: ScoreBands;
  success: boolean;
  busy: boolean;
  busyLabel: string;
  submit: SubmitState;
  onPublish: () => void;
  authError: string | null;
  identityAuthError?: string | null;
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

  return (
    <div style={styles.wrap}>
      <h1 style={styles.h1}>{success ? '✓ Proof published' : 'Proof of Human Writing'}</h1>

      {/* What Human Ink measures, framing up front to distinguish from AI detectors. */}
      <p style={styles.muted}>
        Human Ink evaluates how a document was created, its writing activity, revisions and editing
        history, rather than judging the final wording. Captured from
        {proof.context === 'google-docs' ? ' Google Docs' : ' the web'}{proof.email ? ` · ${proof.email}` : ''}.
      </p>

      {/* HERO, the number on a 100-point scale is the headline. */}
      <div style={{ ...styles.heroCard, borderColor: band.color, margin: '14px 0' }}>
        <div style={{ fontSize: 13, fontWeight: 650, opacity: 0.8 }}>Evidence of Human Authorship</div>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, margin: '6px 0 2px' }}>
          <span style={{ fontSize: 34, fontWeight: 800, color: band.color }}>{authorship.score}</span>
          <span style={{ fontSize: 13, opacity: 0.7 }}>/ 100</span>
        </div>
        <div style={{ ...styles.barWrap, marginTop: 8 }}>
          <div style={{ ...styles.barFill, width: `${authorship.score}%`, background: band.color }} />
        </div>
        <div style={{ fontSize: 12, opacity: 0.7, marginTop: 8 }}>
          {scoreLabel}, our measure of captured writing process.
        </div>
      </div>

      {/* WHAT WE CAPTURED, the facts a professor can read in 20 seconds. Facts
          only — the reader draws the conclusion, we don't hand them one. */}
      <div style={styles.card}>
        <div style={styles.signalHead}>What we captured</div>
        <div style={styles.flagList}>
          {bullets.map((b, i) => (
            <div key={i} style={styles.flag}>
              <span style={{ ...styles.flagDot, color: '#6ee7b7' }}>•</span>
              <span style={styles.flagText}>{b}</span>
            </div>
          ))}
        </div>
      </div>

      {/* AUTHENTIC REVISION, one of the strongest trust signals, placed up high. */}
      <div style={{ ...styles.card, borderColor: integrity.color }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 14, fontWeight: 700, color: integrity.color, marginBottom: 8 }}>
          Revision authenticity {integrity.score}
          <InfoDot text={INTEGRITY_INFO} />
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
        <PasteDisclosure authorship={authorship} />
      </div>

      {/* EVIDENCE CARDS, then a drop-down with the per-signal breakdown (shared with A). */}
      <EvidenceCards proof={proof} authorship={authorship} />
      <ScoreCalcDetails authorship={authorship} scoreLabel={scoreLabel} />

      {/* AI PROBABILITY, deliberately small and secondary (same framing as A). */}
      <div style={{ ...styles.card, padding: '10px 14px', opacity: 0.85 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
          <span style={{ fontSize: 12, opacity: 0.7 }}>{aiLabel}</span>
          <span style={{ fontSize: 18, fontWeight: 700, color: ai.color }}>{ai.ai}%</span>
        </div>
        <p style={{ ...styles.muted, margin: '4px 0 0' }}>
          {ai.source === 'model'
            ? `Independent post-hoc detector, a parallel reference, not part of the ${scoreLabel}.`
            : `Detector unavailable, so this is a rough heuristic estimate, not a model result. A parallel reference, not part of the ${scoreLabel}.`}
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
            {busy ? busyLabel : SIMULATE ? 'Publish proof on-chain' : 'Continue with Google & publish'}
          </button>
          {(authError || identityAuthError) && <p style={styles.error}>{authError || identityAuthError}</p>}
          {submit.phase === 'error' && <p style={styles.error}>{submit.message}</p>}
          <Link to="/" style={{ ...styles.link, marginTop: 14, display: 'block' }}>Cancel</Link>
        </>
      )}
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
/**
 * Receipts hero (creator variant) — descriptive proof-of-work, not a score.
 * The kill ratio is the headline (writers are proud of cutting); active time,
 * sessions, keystrokes, revisions and a cadence sparkline round it out.
 */
function ReceiptsHero({ proof, verified }: { proof: ExtensionProof; verified: boolean }) {
  const r = computeReceipts(proof);
  const kill = r.wordsPublished > 0 ? r.killRatio.toFixed(2) : '—';
  const stat = (v: string | number, l: string) => (
    <div style={styles.receiptStat}><span style={styles.receiptNum}>{v}</span><span style={styles.receiptLbl}>{l}</span></div>
  );
  return (
    <div style={{ ...styles.heroCard, margin: '16px 0', borderColor: 'rgba(0,180,216,0.5)' }}>
      <div style={styles.heroHead}>
        <span style={styles.heroLabel}>The receipts</span>
        {verified && <span style={styles.verifiedPill}>✓ Verified on-chain</span>}
      </div>
      <div style={styles.receiptGrid}>
        {stat(fmtDuration(r.activeSeconds), 'active writing')}
        {stat(`${kill}×`, 'words cut ratio')}
        {stat(r.wordsPublished.toLocaleString(), 'words published')}
        {stat(r.keystrokes.toLocaleString(), 'keystrokes')}
        {stat(r.revisions || '—', 'revisions')}
        {stat(r.sessions, r.sessions === 1 ? 'session' : 'sessions')}
      </div>
      {r.wpmSeries.length > 1 && (
        <div style={{ marginTop: 14 }}>
          <div style={styles.receiptCadenceLbl}>Typing cadence{r.wpm ? ` · ${r.wpm} WPM` : ''}</div>
          <Sparkline series={r.wpmSeries} />
        </div>
      )}
    </div>
  );
}

/** After publishing: the embeddable Craft Card + its snippet and permalink. */
function CraftCardEmbed({ entryId }: { entryId: number }) {
  const origin = window.location.origin;
  const badgeUrl = `${origin}/badge?id=${entryId}`;
  const permalink = `${origin}/feed/${entryId}`;
  const iframe = `<iframe src="${badgeUrl}" width="380" height="150" frameborder="0" title="Human Ink Craft Card" style="border:0;overflow:hidden"></iframe>`;
  return (
    <div style={styles.card}>
      <div style={styles.sec}>Your Craft Card</div>
      <p style={styles.muted}>Embed this on your post so readers can see — and verify — the work behind it.</p>
      <div style={{ display: 'flex', justifyContent: 'center', padding: '8px 0' }}>
        <iframe src={badgeUrl} width={380} height={150} title="craft card preview" style={{ border: 0, maxWidth: '100%' }} />
      </div>
      <CopyRow label="Embed on your site (HTML)" value={iframe} />
      <CopyRow label="Permalink" value={permalink} />
    </div>
  );
}

function CopyRow({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => { try { navigator.clipboard.writeText(value); setCopied(true); window.setTimeout(() => setCopied(false), 1400); } catch { /* no clipboard */ } };
  return (
    <div style={{ marginTop: 10 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={styles.fieldLabel}>{label}</span>
        <button style={styles.copyBtn} onClick={copy}>{copied ? 'Copied ✓' : 'Copy'}</button>
      </div>
      <div style={styles.codeBox}>{value}</div>
    </div>
  );
}

/** Tiny cadence sparkline (bars), cyan brand. Pure inline SVG. */
function Sparkline({ series }: { series: number[] }) {
  const W = 320, H = 40, gap = 2;
  const n = series.length;
  const max = Math.max(1, ...series);
  const bw = Math.max(1, (W - gap * (n - 1)) / n);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ display: 'block' }}>
      {series.map((v, i) => {
        const h = Math.max(2, (v / max) * (H - 4));
        return <rect key={i} x={(i * (bw + gap)).toFixed(1)} y={(H - h).toFixed(1)} width={bw.toFixed(1)} height={h.toFixed(1)} rx={1} fill="var(--hi-cyan, #00b4d8)" opacity={0.85} />;
      })}
    </svg>
  );
}

function HIFeedToggle({ optIn, setOptIn, username }: { optIn: boolean; setOptIn: (v: boolean) => void; username: string }) {
  return (
    <div style={styles.card}>
      <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 14, fontWeight: 600 }}>
        <input type="checkbox" checked={optIn} onChange={(e) => setOptIn(e.target.checked)} style={{ width: 16, height: 16 }} />
        Feature on the public HI Feed
      </label>
      <p style={{ ...styles.muted, margin: '6px 0 0' }}>
        This piece is saved to your creator profile{username ? <> as <strong>{username}</strong></> : null} either way. Check this to also show it on the public HI Feed.
      </p>
    </div>
  );
}

/** Post-publish status: saved to the creator's profile, and to HI Feed if public. */
function HIFeedStatus({ state, msg, isPublic }: { state: 'idle' | 'saving' | 'done' | 'error'; msg: string; isPublic: boolean }) {
  if (state === 'idle') return null;
  return (
    <div style={styles.card}>
      <div style={styles.sec}>{isPublic ? 'HI Feed' : 'Your work'}</div>
      {state === 'saving' && <p style={styles.muted}>{isPublic ? 'Publishing to HI Feed…' : 'Saving to your profile…'}</p>}
      {state === 'done' && (
        <>
          <p style={styles.muted}>{msg || (isPublic ? 'Published to HI Feed and saved to your profile.' : 'Saved to your profile.')}</p>
          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
            <Link to="/me" style={styles.link}>View your profile →</Link>
            {isPublic && <Link to="/feed" style={styles.link}>View HI Feed →</Link>}
          </div>
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
  ai: AiResult;
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
      {/* e.g. "already recorded on-chain, so no new transaction was sent" — the
          student needs to know why there is an entry but no transaction hash. */}
      {result?.statusNote && <p style={styles.muted}>{result.statusNote}</p>}

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

/**
 * Pasted-character disclosure, shown beside the revision-authenticity score.
 * Pasting is TRACKED IN FULL and NEVER DEDUCTED. This exists so a professor can
 * see exactly how much text arrived from outside and read, in the same breath,
 * that it did not cost the writer anything.
 */
function PasteDisclosure({ authorship }: { authorship: ReturnType<typeof computeAuthorshipScore> }) {
  const n = (x: number) => Math.round(x).toLocaleString();
  // Text the writer cut and repositioned inside their own document is editing,
  // not pasting, so it is not counted or named here.
  const ext = authorship.externalPastedChars;
  const cited = authorship.citedPastedChars;
  const total = ext + cited;
  // Say the most specific true thing, without repeating a number back to itself.
  const headline = total === 0 ? 'Nothing was pasted in.'
    : ext === 0 ? `${n(cited)} characters quoted from a cited source.`
    : cited === 0 ? `${n(ext)} characters pasted in from outside the document.`
    : `${n(total)} characters pasted in: ${n(ext)} from outside the document, ${n(cited)} quoted from a cited source.`;
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, marginTop: 10, paddingTop: 10, borderTop: '1px solid rgba(127,127,127,0.18)' }}>
      <span style={{ ...styles.flagDot, color: '#93c5fd' }}>ⓘ</span>
      <span style={styles.flagText}>
        <b style={{ fontWeight: 700 }}>{headline}</b>{' '}
        {total > 0
          ? 'Tracked and shown in full, never deducted: there are too many honest reasons to paste. Pasted text simply adds length without adding writing time, revision or edit bursts.'
          : 'Every character of this document was typed here.'}
      </span>
    </div>
  );
}

function ScoreBreakdown({ authorship, scoreLabel = 'Process Score' }: { authorship: ReturnType<typeof computeAuthorshipScore>; scoreLabel?: string }) {
  // The score is a weighted blend of three dimensions, so the breakdown is that
  // blend shown in full: each dimension's own 0–100, the weight it carries, and
  // the points it therefore contributed — then the total.
  const tone = (s: number) => (s >= 80 ? '#6ee7b7' : s >= 60 ? '#fbbf24' : '#f87171');
  return (
    <div style={styles.card}>
      <div style={styles.signalHead}>How the {scoreLabel} is built</div>
      <div style={styles.flagList}>
        {authorship.dimensions.map((d) => (
          <div key={d.key} style={{ padding: '8px 0', borderBottom: '1px solid rgba(127,127,127,0.12)' }}>
            <div style={{ ...styles.row, alignItems: 'center' }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                <span style={{ color: tone(d.score), fontWeight: 700, width: 52, flexShrink: 0 }}>
                  {d.points.toFixed(1)}
                  <span style={{ opacity: 0.45, fontWeight: 500 }}>/{d.max}</span>
                </span>
                <span style={{ minWidth: 0 }}>
                  <span style={{ fontSize: 13, fontWeight: 600, display: 'block' }}>
                    {d.label}
                    <span style={{ opacity: 0.5, fontWeight: 500 }}> · {Math.round(d.weight * 100)}% of the score</span>
                  </span>
                  <span style={{ fontSize: 11, opacity: 0.6 }}>{d.detail}</span>
                </span>
              </span>
              <span style={{ fontSize: 12, fontWeight: 700, color: tone(d.score), flexShrink: 0 }}>{d.score}/100</span>
            </div>
            {d.parts.map((p, i) => (
              <div key={i} style={{ fontSize: 11, opacity: 0.62, margin: '5px 0 0 62px' }}>
                <b style={{ fontWeight: 600, opacity: 0.85 }}>{p.label}:</b> {p.detail}
              </div>
            ))}
          </div>
        ))}
        <div style={{ ...styles.row, padding: '10px 0 0', marginTop: 4, fontWeight: 700 }}>
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
/**
 * The document check. The professor pastes the text they were handed; it is cut
 * into passages, hashed, and compared with the passage fingerprint stored in the
 * proof, all in this browser. The number is how much of the proven document the
 * pasted text contains. Passages the pasted text has that the proof does not are
 * shown back (they are the professor's own paste); passages the proof has that the
 * text lacks can only be counted, since their text was never stored.
 */
function DocumentCheck({ proof }: { proof: ExtensionProof }) {
  const [text, setText] = useState('');
  const [result, setResult] = useState<DocumentMatch | null>(null);
  const fp = proof.contentFingerprint;
  const pct = (x: number) => (Number.isInteger(x) ? `${x}%` : `${x.toFixed(1)}%`);
  const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

  return (
    <div style={styles.card}>
      <div style={styles.sec}>Check the submitted document</div>
      {!fp ? (
        <p style={styles.muted}>
          Not available for this submission. It was published before passage fingerprints
          were recorded, so there is nothing here to compare a text against.
        </p>
      ) : (
        <>
          <p style={styles.muted}>
            Paste the text the student handed in. It is compared, in your browser only, with
            a fingerprint of the document this proof was made from. Spacing, formatting and
            the Human Ink link are ignored.
          </p>
          <textarea
            style={{ ...styles.textarea, minHeight: 120 }}
            value={text}
            placeholder="Paste the submitted essay here"
            onChange={(e) => { setText(e.target.value); setResult(null); }}
          />
          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            <button
              style={{ ...styles.seeWhy, margin: 0, maxWidth: 160, opacity: text.trim() ? 1 : 0.5 }}
              disabled={!text.trim()}
              onClick={() => setResult(compareToFingerprint(text, proof))}
            >
              Compare
            </button>
            {result && (
              <button style={{ ...styles.seeWhy, margin: 0, maxWidth: 120 }} onClick={() => { setText(''); setResult(null); }}>
                Clear
              </button>
            )}
          </div>

          {result && !result.available && (
            <p style={styles.muted}>
              This fingerprint was recorded under a different normalisation and cannot be compared here.
            </p>
          )}

          {result && result.available && (
            <div style={{ marginTop: 12 }}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 34, fontWeight: 800, lineHeight: 1, color: result.color }}>{pct(result.coverage)}</span>
                <span style={styles.muted}>of the proven document appears in this text</span>
              </div>
              <div style={{ marginTop: 8 }}>
                <Row k="Passages in the proof" v={`${result.proofPassages}: ${result.matchedPassages} found, ${result.missingPassages} missing`} />
                <Row
                  k="Not in the proof"
                  v={result.unmatched.length === 0
                    ? 'nothing in this text'
                    : `${plural(result.unmatched.length, 'passage', 'passages')} in this text, ${pct(result.extra)} of it`}
                />
                {result.removedLinks > 0 && <Row k="Ignored" v={plural(result.removedLinks, 'Human Ink link', 'Human Ink links')} />}
                {result.exact && <Row k="Content hash" v="identical to the proof, byte for byte" />}
              </div>
              {result.unmatched.length > 0 && (
                <div style={{ marginTop: 10 }}>
                  <div style={styles.fieldLabel}>In this text, not in the proven document</div>
                  {result.unmatched.slice(0, 12).map((u, i) => (
                    <p key={i} style={{ ...styles.muted, opacity: 0.9, borderLeft: '2px solid #fbbf24', paddingLeft: 8, margin: '6px 0' }}>
                      {u.text.length > 220 ? `${u.text.slice(0, 220)}…` : u.text}
                    </p>
                  ))}
                  {result.unmatched.length > 12 && (
                    <p style={styles.muted}>and {result.unmatched.length - 12} more</p>
                  )}
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

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
function RevisionCharts({ proof, pasteEvents }: { proof: ExtensionProof; pasteEvents?: PasteEvent[] }) {
  const rev = proof.revision || null;
  // Match each paste entry in the timeline to its stored text (professor-only).
  // Both lists are chronological, so within an origin group we can pair them in
  // order; internal moves are never persisted, so they simply have no text.
  const pasteText = useMemo(() => matchPasteText(rev?.timeline, pasteEvents), [rev, pasteEvents]);
  // Internal moves read as ordinary writing everywhere else on this page, so the
  // counts here must agree: a repositioned sentence is a typing run, not a paste.
  const counts = useMemo(() => {
    const tl = rev?.timeline || [];
    const moves = tl.filter((e) => e.type === 'paste' && e.origin === 'internal_move').length;
    const pastes = tl.filter((e) => e.type === 'paste').length - moves;
    return { typed: (rev?.typedEdits || 0) + moves, pastes };
  }, [rev]);
  if (!rev || rev.editCount === 0 || !rev.timeline || rev.timeline.length === 0) return null;
  return (
    <div style={styles.card}>
      <div style={styles.signalHead}>Revision analysis</div>

      <div style={{ marginTop: 8 }}>
        <div style={styles.chartTitle}>How the document grew</div>
        <p style={styles.chartCaption}>Did it build up steadily, or appear in sudden blocks? Green = typed, amber = pasted in.{pasteText.size > 0 ? ' Hover an amber cliff to read exactly what was pasted.' : ''}</p>
        <WritingTimelineChart timeline={rev.timeline} docs={proof.docsRevision} pasteText={pasteText} />
      </div>

      <div style={{ marginTop: 22 }}>
        <div style={styles.chartTitle}>When the bursts happened</div>
        <p style={styles.chartCaption}>Each run of typing on a real time axis. Gaps are time away from the document.</p>
        <BurstChart timeline={rev.timeline} byTime pasteText={pasteText} />
      </div>

      <div style={{ marginTop: 16 }}>
        <Row k="Typing bursts" v={`${counts.typed} runs of continuous typing`} />
        {counts.pastes > 0 && <Row k="Paste insertions" v={`${counts.pastes} pasted in from elsewhere`} />}
      </div>

      {pasteEvents && pasteEvents.length > 0 && <PastedContentList events={pasteEvents} />}
    </div>
  );
}

/**
 * Pair paste entries in the writing timeline with their captured text. paste_events
 * only stores foreign content (external + cited pastes), never internal moves — so
 * we group events by origin and hand them out, in chronological order, to the
 * timeline pastes of the matching origin. Returns timeline-index → PasteEvent.
 */
function matchPasteText(
  timeline?: { type: 'type' | 'paste'; chars: number; origin?: PasteOrigin; t?: number }[],
  events?: PasteEvent[],
): Map<number, PasteEvent> {
  const out = new Map<number, PasteEvent>();
  if (!timeline || !events || events.length === 0) return out;
  // FIFO queue of events per origin (chronological, as returned by the API).
  const queues = new Map<string, PasteEvent[]>();
  for (const e of events) {
    const o = e.origin || 'external';
    if (!queues.has(o)) queues.set(o, []);
    queues.get(o)!.push(e);
  }
  timeline.forEach((t, i) => {
    if (t.type !== 'paste') return;
    const o = t.origin || 'external';
    if (o === 'internal_move') return; // never persisted — no text to show
    const q = queues.get(o);
    const ev = q && q.shift();
    if (ev) out.set(i, ev);
  });
  return out;
}

/** Collapse whitespace and trim a pasted blob to a readable one-liner for tooltips. */
function pasteSnippet(text: string, max = 160): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  return clean.length > max ? `${clean.slice(0, max)}…` : clean;
}

/**
 * Professor-only reading panel: the full text behind every amber paste in the
 * charts, so a reviewer can see whether a block was a cited quote or something
 * dropped in wholesale. Amber = external, purple = quoted source (same palette as
 * the charts). Long/truncated pastes scroll inside their own box.
 */
function PastedContentList({ events: allEvents }: { events: PasteEvent[] }) {
  // The writer's own text, cut and repositioned, is not "pasted in" content.
  const events = allEvents.filter((e) => e.origin !== 'internal_move');
  if (events.length === 0) return null;
  return (
    <div style={{ marginTop: 20 }}>
      <div style={styles.chartTitle}>What was pasted in</div>
      <p style={styles.chartCaption}>The exact text behind each amber block above, visible to you as the professor only. {events.length} {events.length === 1 ? 'paste' : 'pastes'} captured.</p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 6 }}>
        {events.map((e, i) => {
          const color = e.origin === 'cited_source' ? CHART_CITED : CHART_EXTERNAL;
          const label = e.origin === 'cited_source' ? 'quoted source' : 'pasted in';
          const when = fmtTipDate(e.pastedAt);
          return (
            <div key={i} style={{ border: '1px solid rgba(255,255,255,0.12)', borderLeft: `3px solid ${color}`, borderRadius: 8, padding: '8px 10px', background: 'rgba(255,255,255,0.02)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 11, opacity: 0.7, marginBottom: 5, flexWrap: 'wrap' }}>
                <span style={{ color, fontWeight: 700 }}>● {label} · {e.charCount.toLocaleString()} chars{e.isLarge ? ' · large' : ''}</span>
                {when && <span>{when}</span>}
              </div>
              <div style={{ fontSize: 12.5, lineHeight: 1.5, whiteSpace: 'pre-wrap', wordBreak: 'break-word', maxHeight: 160, overflow: 'auto', fontFamily: 'ui-monospace, Menlo, monospace', opacity: 0.92 }}>
                {e.content}{e.truncated ? '…' : ''}
              </div>
              {e.truncated && <div style={{ fontSize: 10.5, opacity: 0.55, marginTop: 4 }}>Truncated at capture (very long paste).</div>}
            </div>
          );
        })}
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
 * True-pixel chart sizing: measure the container and draw the SVG 1:1 instead of
 * stretching a tiny fixed viewBox to 100% width (which scaled fonts/strokes ~3×
 * on desktop and made the charts look bloated). Fonts stay crisp at any width.
 */
function useMeasuredWidth(fallback = 320) {
  const ref = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(fallback);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const cw = entries[0]?.contentRect?.width;
      if (cw && Math.abs(cw - w) > 1) setW(cw);
    });
    ro.observe(el);
    if (el.clientWidth) setW(el.clientWidth);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return [ref, w] as const;
}

// Provenance palette + labels, shared by both revision charts. Text the writer
// cut and repositioned inside their own document reads as ordinary writing: it
// is their own words either way, so it is not singled out as a paste.
const CHART_TYPE = '#6ee7b7', CHART_EXTERNAL = '#fbbf24', CHART_CITED = '#a78bfa';
function provColor(e: { type: string; origin?: PasteOrigin }) {
  return e.type !== 'paste' || e.origin === 'internal_move' ? CHART_TYPE
    : e.origin === 'cited_source' ? CHART_CITED
    : CHART_EXTERNAL;
}
function provLabel(e: { type: string; origin?: PasteOrigin }) {
  return e.type !== 'paste' || e.origin === 'internal_move' ? 'typed'
    : e.origin === 'cited_source' ? 'quoted source'
    : 'pasted in';
}
/** Exact clock time, to the minute, in the READER's timezone with the zone named.
 *  Used everywhere a professor reads "when did this happen" — a paste at 11:58pm
 *  the night a paper was due is a different fact from a paste on that date, and
 *  the zone has to be explicit because reader and writer may not share one.
 *  (We render the reader's zone: the writer's own timezone is not captured — the
 *  extension stores UTC only. Capturing it would need a session-row column.) */
const fmtTipDate = (ms?: number | null) =>
  ms ? new Date(ms).toLocaleString(undefined, {
    month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short',
  }) : null;

/** Floating HTML tooltip for the inline-SVG charts. Positioned by mapping a viewBox
 *  coordinate to a percentage of the container (the SVG scales to 100% width). */
function ChartTip({ vx, vy, W, H, lines }: { vx: number; vy: number; W: number; H: number; lines: React.ReactNode[] }) {
  const left = (vx / W) * 100;
  const top = (vy / H) * 100;
  const flipX = left > 62;
  return (
    <div style={{
      position: 'absolute', left: `${left}%`, top: `${top}%`,
      transform: `translate(${flipX ? 'calc(-100% - 8px)' : '8px'}, -116%)`,
      pointerEvents: 'none', zIndex: 5, whiteSpace: 'nowrap',
      background: '#0f172a', color: '#f8fafc', border: '1px solid rgba(255,255,255,0.14)',
      borderRadius: 6, padding: '5px 8px', fontSize: 11.5, lineHeight: 1.4,
      boxShadow: '0 6px 18px rgba(0,0,0,0.28)',
    }}>
      {lines.map((l, i) => <div key={i} style={i === 0 ? { fontWeight: 700 } : { opacity: 0.85 }}>{l}</div>)}
    </div>
  );
}

/** The pasted text, quoted and wrapped, shown inside a chart tooltip (professor
 *  view). Overrides the tooltip's default single-line layout so a paste is readable. */
function PasteTipQuote({ text }: { text: string }) {
  return (
    <span style={{
      display: 'block', whiteSpace: 'normal', maxWidth: 260, marginTop: 3,
      paddingTop: 3, borderTop: '1px solid rgba(255,255,255,0.14)',
      fontStyle: 'italic', opacity: 0.95, lineHeight: 1.35,
    }}>
      “{pasteSnippet(text)}”
    </span>
  );
}

/**
 * Document-growth chart: how the piece was written, in order. X spans the real
 * editing date range (from Google Docs revision history when available); Y is the
 * cumulative size of the document as each edit lands. Typed work rises in a gentle
 * green slope; pasted blocks show as amber vertical cliffs, the visual signature
 * of text dropped in rather than written. Hover any point to read the exact edit.
 * Pure inline SVG, no chart library.
 */
function WritingTimelineChart({
  timeline,
  docs,
  pasteText,
}: {
  timeline: { type: 'type' | 'paste'; chars: number; origin?: PasteOrigin; t?: number }[];
  docs?: ExtensionProof['docsRevision'];
  pasteText?: Map<number, PasteEvent>;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const [boxRef, mw] = useMeasuredWidth();
  // Drawn at the container's true pixel width — crisp 10–11px labels, fixed
  // height, no viewBox stretching.
  const W = Math.max(300, mw), H = 230, padL = 56, padR = 14, padT = 16, padB = 44;
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

  const segments = timeline.map((e, i) => ({
    x1: x(i), y1: y(cum[i]), x2: x(i + 1), y2: y(cum[i + 1]),
    paste: e.type === 'paste',
    color: provColor(e),
  }));
  const areaPts = cum.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  const baseY = y(0);
  const areaPath = `${padL},${baseY} ${areaPts} ${x(n - 1).toFixed(1)},${baseY}`;

  // Per-edit hover bands: from the midpoint to the previous point to the midpoint to
  // the next, so the whole width is hoverable and lands on the nearest edit.
  const xs = timeline.map((_, i) => x(i + 1));
  const band = (i: number) => {
    const l = i === 0 ? padL : (xs[i - 1] + xs[i]) / 2;
    const r = i === xs.length - 1 ? W - padR : (xs[i] + xs[i + 1]) / 2;
    return { l, w: Math.max(0.5, r - l) };
  };

  // Y axis ticks (characters) and X axis end labels (dates).
  const yTicks = [0, 0.5, 1].map((f) => ({ v: Math.round(total * f), yy: y(total * f) }));
  const fmtDate = (ms?: number | null) => (ms ? new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : null);
  const startLabel = (hasTime ? fmtDate(tMin) : fmtDate(docs?.firstModified)) || 'start';
  const endLabel = (hasTime ? fmtDate(tMax) : fmtDate(docs?.lastModified)) || 'finish';

  const active = hover != null ? { e: timeline[hover], px: xs[hover], py: y(cum[hover + 1]), cumv: cum[hover + 1] } : null;

  return (
    <div ref={boxRef} style={{ position: 'relative', margin: '4px 0 12px', width: '100%' }}>
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} style={{ display: 'block' }}
        onMouseLeave={() => setHover(null)}>
        <defs>
          <linearGradient id="wtGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="rgba(110,231,183,0.28)" />
            <stop offset="100%" stopColor="rgba(110,231,183,0.02)" />
          </linearGradient>
        </defs>

        {/* Y axis: gridlines + character tick labels */}
        {yTicks.map((t, i) => (
          <g key={`y${i}`}>
            <line x1={padL} y1={t.yy} x2={W - padR} y2={t.yy} stroke="currentColor" strokeOpacity={i === 0 ? 0.18 : 0.08} strokeWidth={1} />
            <text x={padL - 7} y={t.yy + 3.5} fill="currentColor" opacity={0.55} fontSize={11} textAnchor="end">{t.v.toLocaleString()}</text>
          </g>
        ))}
        <text transform={`rotate(-90 13 ${padT + innerH / 2})`} x={13} y={padT + innerH / 2} fill="currentColor" opacity={0.6} fontSize={11} fontWeight={600} textAnchor="middle">Characters</text>

        <polygon points={areaPath} fill="url(#wtGrad)" />
        {segments.map((s, i) => (
          <line key={i} x1={s.x1} y1={s.y1} x2={s.x2} y2={s.y2} stroke={s.color} strokeWidth={s.paste ? 3 : 2} strokeLinecap="round" />
        ))}
        {segments.map((s, i) => s.paste ? <circle key={`p${i}`} cx={s.x2} cy={s.y2} r={3.5} fill={s.color} /> : null)}

        {/* X axis: date range + title */}
        <text x={padL} y={H - 18} fill="currentColor" opacity={0.55} fontSize={11}>{startLabel}</text>
        <text x={W - padR} y={H - 18} fill="currentColor" opacity={0.55} fontSize={11} textAnchor="end">{endLabel}</text>
        <text x={padL + innerW / 2} y={H - 5} fill="currentColor" opacity={0.6} fontSize={11} fontWeight={600} textAnchor="middle">Time →</text>

        {/* Hover: marker + transparent hit bands (drawn last so they capture events) */}
        {active && (
          <>
            <line x1={active.px} y1={padT} x2={active.px} y2={baseY} stroke="currentColor" strokeOpacity={0.25} strokeWidth={1} strokeDasharray="2 2" />
            <circle cx={active.px} cy={active.py} r={4.2} fill={provColor(active.e)} stroke="#fff" strokeWidth={1.4} />
          </>
        )}
        {timeline.map((_, i) => {
          const b = band(i);
          return <rect key={`h${i}`} x={b.l} y={padT} width={b.w} height={innerH} fill="transparent"
            onMouseEnter={() => setHover(i)} onMouseMove={() => setHover(i)} style={{ cursor: 'pointer' }} />;
        })}
      </svg>

      {active && (
        <ChartTip vx={active.px} vy={active.py} W={W} H={H} lines={[
          `+${active.e.chars.toLocaleString()} chars`,
          provLabel(active.e),
          `${active.cumv.toLocaleString()} chars total so far`,
          ...(active.e.t ? [fmtTipDate(active.e.t)] : []),
          ...(hover != null && pasteText?.get(hover) ? [<PasteTipQuote key="q" text={pasteText.get(hover)!.content} />] : []),
        ]} />
      )}

      <div style={{ ...styles.scoreRow, flexWrap: 'wrap', gap: 8 }}>
        <span><span style={{ color: CHART_TYPE }}>●</span> typed</span>
        <span><span style={{ color: CHART_EXTERNAL }}>●</span> pasted in (cliffs)</span>
        {segments.some((s) => s.color === CHART_CITED) && <span><span style={{ color: CHART_CITED }}>●</span> quoted</span>}
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
  pasteText,
}: {
  timeline: { type: 'type' | 'paste'; chars: number; origin?: PasteOrigin; t?: number }[];
  byTime?: boolean;
  pasteText?: Map<number, PasteEvent>;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const [boxRef, mw] = useMeasuredWidth();
  // True-pixel sizing (see useMeasuredWidth) — fixed height, crisp labels.
  const W = Math.max(300, mw), H = 180, padT = 14, padB = 44, padL = 56, padR = 14;
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
  const idxGap = n > 60 ? 1 : 3;
  // Cap bar width so a handful of bursts on a wide page reads as tidy bars, not
  // giant slabs; when capped, center the group in the plot area.
  const idxBwRaw = n > 0 ? Math.max(1, (innerW - idxGap * (n - 1)) / n) : innerW;
  const idxBw = Math.min(idxBwRaw, 26);
  const groupW = n * idxBw + (n - 1) * idxGap;
  const idxX0 = padL + Math.max(0, (innerW - groupW) / 2);
  const bw = useTime ? Math.max(2, Math.min(idxBw, 6)) : idxBw;
  const xAt = (i: number) =>
    useTime ? padL + ((ts[i] - tMin) / tSpan) * (innerW - bw)
            : idxX0 + i * (idxBw + idxGap);
  const barH = (chars: number) => Math.max(2, (chars / max) * innerH);
  const barY = (chars: number) => padT + innerH - barH(chars);

  const fmtDate = (ms: number) => new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  // Y axis ticks (characters).
  const yTicks = [0, 0.5, 1].map((f) => ({ v: Math.round(max * f), yy: padT + innerH - f * innerH }));

  const active = hover != null ? { e: timeline[hover], px: xAt(hover) + bw / 2, py: barY(timeline[hover].chars) } : null;

  return (
    <div ref={boxRef} style={{ position: 'relative', margin: '4px 0 12px', width: '100%' }}>
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} style={{ display: 'block' }}
        onMouseLeave={() => setHover(null)}>
        {/* Y axis: gridlines + character tick labels + title */}
        {yTicks.map((t, i) => (
          <g key={`y${i}`}>
            <line x1={padL} y1={t.yy} x2={W - padR} y2={t.yy} stroke="currentColor" strokeOpacity={i === 0 ? 0.18 : 0.08} strokeWidth={1} />
            <text x={padL - 7} y={t.yy + 3.5} fill="currentColor" opacity={0.55} fontSize={11} textAnchor="end">{t.v.toLocaleString()}</text>
          </g>
        ))}
        <text transform={`rotate(-90 13 ${padT + innerH / 2})`} x={13} y={padT + innerH / 2} fill="currentColor" opacity={0.6} fontSize={11} fontWeight={600} textAnchor="middle">Characters</text>

        {timeline.map((e, i) => (
          <rect key={i} x={xAt(i).toFixed(1)} y={barY(e.chars).toFixed(1)} width={bw.toFixed(1)} height={barH(e.chars).toFixed(1)} rx={2}
            fill={provColor(e)} opacity={hover == null || hover === i ? 1 : 0.45} />
        ))}

        {/* X axis: date range (time mode) or burst-order note, + title */}
        {useTime ? (
          <>
            <text x={padL} y={H - 18} fill="currentColor" opacity={0.55} fontSize={11}>{fmtDate(tMin)}</text>
            <text x={W - padR} y={H - 18} fill="currentColor" opacity={0.55} fontSize={11} textAnchor="end">{fmtDate(tMax)}</text>
            <text x={padL + innerW / 2} y={H - 5} fill="currentColor" opacity={0.6} fontSize={11} fontWeight={600} textAnchor="middle">Time →</text>
          </>
        ) : (
          <text x={padL + innerW / 2} y={H - 7} fill="currentColor" opacity={0.6} fontSize={11} fontWeight={600} textAnchor="middle">Bursts in order →</text>
        )}

        {/* Wide transparent hit targets so thin time-mode bars are still hoverable */}
        {timeline.map((_, i) => {
          const c = xAt(i) + bw / 2;
          const hw = Math.max(bw, 7);
          return <rect key={`h${i}`} x={(c - hw / 2).toFixed(1)} y={padT} width={hw.toFixed(1)} height={innerH} fill="transparent"
            onMouseEnter={() => setHover(i)} onMouseMove={() => setHover(i)} style={{ cursor: 'pointer' }} />;
        })}
      </svg>

      {active && (
        <ChartTip vx={active.px} vy={active.py} W={W} H={H} lines={[
          `${active.e.chars.toLocaleString()} chars`,
          provLabel(active.e),
          ...(active.e.t ? [fmtTipDate(active.e.t)] : []),
          ...(hover != null && pasteText?.get(hover) ? [<PasteTipQuote key="q" text={pasteText.get(hover)!.content} />] : []),
        ]} />
      )}

      {/* Captions live in normal HTML, not as SVG text (which scales with the chart
          width and balloons). */}
      <div style={{ ...styles.scoreRow, gap: 8 }}>
        <span>{n} {n === 1 ? 'burst' : 'bursts'} · largest {max.toLocaleString()} chars</span>
        {byTime && !hasTime && <span style={{ opacity: 0.75, textAlign: 'right' }}>real-time view fills in after your next capture</span>}
      </div>
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
  // Faint cyan "ink in water" wash behind the top of the report — the brand motif
  // as a pure background gradient (always paints behind content, no z-index games).
  wrap: {
    maxWidth: 'min(1040px, 94vw)', margin: '32px auto', padding: '0 20px', color: 'inherit',
    backgroundImage: 'radial-gradient(ellipse 46% 30% at 82% 4%, rgba(0,180,216,0.10), rgba(0,200,230,0) 70%)',
    backgroundRepeat: 'no-repeat',
  },
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
  receiptGrid: { display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginTop: 8 },
  receiptStat: { display: 'flex', flexDirection: 'column', gap: 2 },
  receiptNum: { fontSize: 24, fontWeight: 800, lineHeight: 1.05, fontVariantNumeric: 'tabular-nums', color: 'var(--hi-cyan-ink, #075985)' },
  receiptLbl: { fontSize: 10.5, textTransform: 'uppercase', letterSpacing: 0.5, opacity: 0.65 },
  receiptCadenceLbl: { fontSize: 11, opacity: 0.6, marginBottom: 4, fontWeight: 600 },
  verifiedPill: { fontSize: 11, fontWeight: 700, color: '#047857', border: '1px solid #a7f3d0', background: '#ecfdf5', borderRadius: 999, padding: '2px 9px' },
  fieldLabel: { fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5, opacity: 0.6, fontWeight: 700 },
  copyBtn: { padding: '4px 12px', borderRadius: 7, border: '1px solid #6ee7b7', background: 'rgba(110,231,183,0.12)', color: '#0b7a5b', fontSize: 12, fontWeight: 700, cursor: 'pointer' },
  codeBox: { marginTop: 6, padding: 10, borderRadius: 8, background: 'rgba(0,0,0,0.05)', border: '1px solid rgba(0,0,0,0.1)', fontFamily: 'ui-monospace, Menlo, monospace', fontSize: 11, wordBreak: 'break-all', lineHeight: 1.5, userSelect: 'all' },
};
