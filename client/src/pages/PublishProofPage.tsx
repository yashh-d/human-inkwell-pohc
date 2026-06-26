import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useLoginWithOAuth, useWallets } from '@privy-io/react-auth';
import { ethers } from 'ethers';
import { blockchainService } from '../blockchain';
import { pushLedgerIndexAfterOnChainSuccess } from '../ledgerSupabase';
import { useViewerAddress } from '../hooks/useViewerAddress';
import { rememberMiniKitWallet } from '../utils/miniKitWallet';

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
const SIMULATE = false;

// Real deployed contract + explorer, from the app's env (falls back to the
// known World Chain Sepolia deployment).
const CONTRACT_ADDRESS = process.env.REACT_APP_CONTRACT_ADDRESS || '0x08A70Fed4d80893fC03Bd3E1D8cfb36E58a9E95d';
const EXPLORER_BASE = (process.env.REACT_APP_BLOCKCHAIN_EXPLORER_URL || 'https://sepolia.worldscan.org').replace(/\/+$/, '');

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

type PasteOrigin = 'internal_move' | 'cited_source' | 'external';
type RevisionAnalysis = {
  editCount: number;
  typedEdits: number;
  pasteEdits: number;
  typedChars: number;
  pastedChars: number;
  // F1 provenance breakdown (older payloads won't have these).
  externalPastedChars?: number;
  internalPastedChars?: number;
  citedPastedChars?: number;
  largestExternalPaste?: number;
  humanTypedRatio: number;
  largestPaste: number;
  timeline?: { type: 'type' | 'paste'; chars: number; origin?: PasteOrigin }[];
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
  docsRevision?: {
    source: string;
    revisionCount: number;
    firstModified: number | null;
    lastModified: number | null;
    spanMs: number;
    spanDays?: number;
    editDays?: number;
    authors: string[];
  } | null;
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

const short = (h?: string | null) => (h ? `${h.slice(0, 10)}…${h.slice(-8)}` : '-');

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

/**
 * F1 paste picture, the single source of truth for "what counts against you".
 * Only EXTERNAL pastes (came from outside the doc) count; cut-and-move of your own
 * text and quoted/cited material do not. A grace budget absorbs legitimate offline
 * drafting (a paragraph written on a phone, an imported outline) before any penalty.
 * Falls back gracefully for older payloads that predate provenance (all pastes
 * treated as external, no grace beyond the floor).
 */
function pasteBreakdown(proof: ExtensionProof) {
  const m = proof.metrics || {};
  const rev = proof.revision || null;
  const hasF1 = !!rev && typeof rev.externalPastedChars === 'number';

  const typedChars = rev ? rev.typedChars : (m.keystrokeCount ?? proof.keystrokeCount ?? 0);
  const externalChars = hasF1 ? (rev!.externalPastedChars || 0) : (m.pastedChars ?? rev?.pastedChars ?? 0);
  const internalChars = hasF1 ? (rev!.internalPastedChars || 0) : 0;
  const citedChars = hasF1 ? (rev!.citedPastedChars || 0) : 0;
  const totalChars = typedChars + externalChars + internalChars + citedChars;

  // Grace budget: up to 10% of the doc, with a ~300-word (~1500 char) floor.
  const graceChars = Math.max(0.10 * totalChars, 1500);
  const penalizedExternal = Math.max(0, externalChars - graceChars);

  // "Own" text = typed + within-doc moves + cited quotes. Only penalized external
  // pasting erodes the written ratio.
  const ownChars = typedChars + internalChars + citedChars;
  const denom = ownChars + penalizedExternal;
  const writtenRatio = denom > 0 ? ownChars / denom : 1;

  const largestExternal = hasF1 ? (rev!.largestExternalPaste || 0) : (m.largestPaste ?? rev?.largestPaste ?? 0);
  return {
    hasF1, typedChars, externalChars, internalChars, citedChars, totalChars,
    graceChars, penalizedExternal, writtenRatio, largestExternal,
  };
}

/**
 * Human Authorship Score, the one number a professor reads in five seconds.
 *
 * Built from the signals that matter most, in priority order: revision depth
 * (the fingerprint of real effort, you cannot fake drafts), writing-vs-pasting,
 * time invested, and editing-over-time. Each signal is normalized 0–100,
 * weighted, and rolled into one score. (We deliberately do NOT score "leaving
 * the doc", tab-switching to research or cite is normal, not a red flag.)
 * Signals with no data are dropped and the remaining weights re-normalized, so
 * the score is always honest about what it actually saw.
 *
 * Every signal carries a one-liner written for a professor, not an engineer -
 * the point is that nobody has to learn anything new to read this.
 */
type AuthorshipSignal = {
  key: string;
  label: string;
  blurb: string;        // one-liner, from the professor's seat
  score: number;        // 0–100
  weight: number;
  detail: string;       // human-readable value
  has: boolean;         // did we actually capture this?
};

function computeAuthorshipScore(proof: ExtensionProof) {
  const m = proof.metrics || {};
  const rev = proof.revision || null;
  const docs = proof.docsRevision || null;

  // 1) REVISION DEPTH, highest weight. Saved Google Docs revisions are signed
  //    by Google, not by us, so this is the one signal that can't be faked.
  const savedRevisions = docs?.revisionCount || 0;
  const editEvents = rev?.editCount || 0;
  const revisionScore = Math.min(100, savedRevisions * 4 + editEvents * 3);

  // 2) TIME INVESTED, real writing takes time. 30 active minutes tops it out.
  const minutes = (m.elapsedMs || 0) / 60000;
  const timeScore = Math.min(100, Math.round((minutes / 30) * 100));

  // 3) WRITTEN, NOT PASTED, own writing vs text pasted in from OUTSIDE the doc
  //    (F1: moving your own text and quoting don't count; grace budget applies).
  const pb = pasteBreakdown(proof);
  const typedScore = Math.round(Math.max(0, Math.min(1, pb.writtenRatio)) * 100);
  const typedDetail = pb.internalChars > 0 || pb.citedChars > 0
    ? `${typedScore}% own · ${pb.externalChars} pasted in${pb.internalChars > 0 ? `, ${pb.internalChars} moved` : ''}`
    : `${typedScore}% typed`;

  // 4) EDITING OVER TIME, work spread across sittings beats one rushed dump.
  const editDays = docs?.editDays || (minutes > 0 ? 1 : 0);
  const spanDays = docs?.spanDays || editDays;
  const overTimeScore = Math.min(100, Math.round((editDays / 4) * 100));

  const signals: AuthorshipSignal[] = [
    {
      key: 'revision',
      label: 'Revision depth',
      blurb: 'Drafts, rewrites and edits, the fingerprint of real effort. You can’t fake a revision history.',
      score: revisionScore,
      weight: 0.33,
      detail: savedRevisions
        ? `${savedRevisions} saved revisions · ${editEvents} edits`
        : `${editEvents} edit events`,
      has: savedRevisions > 0 || editEvents > 0,
    },
    {
      key: 'typed',
      label: 'Written, not pasted',
      blurb: 'Your own writing versus text pasted in from outside the doc. Moving your own text around and quoting sources don’t count against you.',
      score: typedScore,
      weight: 0.28,
      detail: typedDetail,
      has: typeof m.humanTypedRatio === 'number' || !!rev,
    },
    {
      key: 'time',
      label: 'Time invested',
      blurb: 'Genuine writing takes time, not minutes. This is how long they actually spent in the work.',
      score: timeScore,
      weight: 0.22,
      detail: fmtMs(m.elapsedMs),
      has: (m.elapsedMs || 0) > 0,
    },
    {
      key: 'time-span',
      label: 'Editing over time',
      blurb: 'Work spread across days and sittings beats one rushed, single-session dump.',
      score: overTimeScore,
      weight: 0.17,
      detail: editDays <= 1 ? '1 day' : `${editDays} days${spanDays > editDays ? ` (over ${spanDays})` : ''}`,
      has: editDays > 0,
    },
  ];

  const live = signals.filter((s) => s.has);
  const totalWeight = live.reduce((sum, s) => sum + s.weight, 0) || 1;
  const raw = Math.round(live.reduce((sum, s) => sum + s.score * s.weight, 0) / totalWeight);

  // ---- F3 protections (no caret data needed) ----
  // These guard honest writers. The fuller composition-vs-transcription signals
  // (per-region re-edit passes, mid-text vs tail deletions, caret edit-locality)
  // need keystroke caret data the Docs canvas capture can't give us yet, deferred.
  const wpm = m.wpm || 0;
  const effortIndex = Math.round((revisionScore + timeScore + overTimeScore) / 3);
  const protections: string[] = [];
  let score = raw;

  // Halo Effect: deep editing/effort elsewhere forgives isolated external pastes.
  if (effortIndex >= 60 && typedScore < 60 && score < 70) {
    score = Math.min(70, Math.round(score + (effortIndex - score) * 0.4));
    protections.push('Halo effect: deep editing and time elsewhere offset the pasted material.');
  }
  // Linear-Thinker override: a clean front-to-back typist at a human pace is not a
  // cheater, ≥95% own text at normal speed clears straight to the green band.
  if (pb.writtenRatio >= 0.95 && wpm >= 15 && wpm <= 120) {
    score = Math.max(score, DEFAULT_BANDS.green);
    protections.push('Linear-thinker override: ≥95% typed at a normal pace, cleared.');
  }

  const verdict = score >= 75 ? 'Strong proof of human effort'
    : score >= 50 ? 'Solid signs of human work'
    : score >= 30 ? 'Limited evidence of effort'
    : 'Little evidence of original work';
  const color = score >= 75 ? '#6ee7b7' : score >= 50 ? '#a7f3d0' : score >= 30 ? '#fbbf24' : '#f87171';

  return { score, verdict, color, signals, protections, effortIndex };
}

/**
 * F2, the traffic-light band for the Process Score. Thresholds are server-tunable
 * (see /api/scoring-config) with these defaults. Deliberately biased toward YELLOW:
 * a false green is a missed catch, but a false red is a wrongful accusation, so
 * green requires a genuinely strong score and red is reserved for clearly-low ones.
 */
type ScoreBands = { green: number; red: number };
const DEFAULT_BANDS: ScoreBands = { green: 60, red: 30 };
function processBand(score: number, bands: ScoreBands) {
  if (score >= bands.green) return { label: 'Authentic, clear to move on', color: '#6ee7b7', tone: 'green' as const };
  if (score >= bands.red) return { label: 'Worth a glance', color: '#fbbf24', tone: 'yellow' as const };
  return { label: 'Investigate', color: '#f87171', tone: 'red' as const };
}

/** One plain-English line under the Process Score, the "why" for a clean essay. */
function reasonLine(proof: ExtensionProof, score: number): string {
  const pb = pasteBreakdown(proof);
  const writtenPct = Math.round(pb.writtenRatio * 100);
  const editDays = proof.docsRevision?.editDays || 0;
  if (pb.penalizedExternal > 0 && writtenPct < 60) {
    return `Most of the text was pasted in from outside the document; only ${writtenPct}% is the writer’s own.`;
  }
  if (pb.penalizedExternal > 0) {
    return `Some text was pasted in from outside the document; the rest was written here.`;
  }
  if (score >= DEFAULT_BANDS.green) {
    return editDays >= 2
      ? `Typed and revised across ${editDays} days, consistent with original work.`
      : `Typed here with genuine editing, consistent with original work.`;
  }
  return `Limited typing, revision, or time invested for a piece this size.`;
}

/**
 * Revision authenticity, the anti-gaming check. Real, not simulated: it runs
 * entirely on signals we already captured. Genuine drafting leaves a messy
 * texture (deletions, rewrites, work spread across sittings); manufactured
 * revisions look the opposite, big pastes, monotonic growth, all in one go.
 * Each flag is a plain-English observation a professor can sanity-check.
 */
type IntegrityFlag = { level: 'ok' | 'warn' | 'bad'; text: string };

function computeIntegrity(proof: ExtensionProof) {
  const m = proof.metrics || {};
  const rev = proof.revision || null;
  const docs = proof.docsRevision || null;
  const flags: IntegrityFlag[] = [];

  const pb = pasteBreakdown(proof);
  const writtenPct = Math.round(pb.writtenRatio * 100);
  const editDays = docs?.editDays || 0;
  const revisionCount = docs?.revisionCount || 0;
  const editEvents = rev?.editCount || 0;
  const keystrokes = m.keystrokeCount || proof.keystrokeCount || 0;
  const backspaces = m.backspaceCount || 0;

  let penalty = 0;

  // F1: only EXTERNAL pasting (beyond the grace budget) is a concern. A big block
  // pasted from outside the doc is the tell; moving your own text is not.
  if (pb.penalizedExternal > 0 && pb.largestExternal >= 120) {
    flags.push({ level: 'bad', text: `A large block (${pb.largestExternal} chars) was pasted in from outside the document.` });
    penalty += 25;
  } else if (pb.penalizedExternal > 0) {
    flags.push({ level: 'warn', text: `${pb.externalChars} characters were pasted in from outside the document.` });
    penalty += 12;
  } else if (pb.externalChars > 0) {
    flags.push({ level: 'ok', text: `Small amount pasted in (${pb.externalChars} chars), within the normal allowance.` });
  } else {
    flags.push({ level: 'ok', text: 'Nothing was pasted in from outside, the text was built up here.' });
  }

  // Credit within-doc moves so they're not mistaken for foreign pastes.
  if (pb.internalChars > 0) {
    flags.push({ level: 'ok', text: `${pb.internalChars} chars were moved within the doc (your own text), not counted against you.` });
  }

  // How much is the writer's own (typed + moved + quoted) vs external.
  if (writtenPct < 50) {
    flags.push({ level: 'bad', text: `Only ${writtenPct}% of the text is the writer’s own; most came from outside.` });
    penalty += 25;
  } else if (writtenPct < 85) {
    flags.push({ level: 'warn', text: `${writtenPct}% is the writer’s own, some content came from outside.` });
    penalty += 10;
  }

  // Many revisions, but all in one sitting, the manufactured-draft pattern.
  if ((revisionCount >= 6 || editEvents >= 12) && editDays <= 1) {
    flags.push({ level: 'warn', text: `${revisionCount || editEvents} revisions but all in one sitting, genuine drafting usually spreads across sessions.` });
    penalty += 15;
  }

  // Real revising deletes and rewrites; text that only ever grew is suspect.
  if (keystrokes > 200 && backspaces === 0) {
    flags.push({ level: 'warn', text: 'Revisions only added text, no deletions or rewrites, unusual for genuine editing.' });
    penalty += 15;
  } else if (backspaces > 0) {
    flags.push({ level: 'ok', text: 'Edits include deletions and rewrites, the texture of real revising.' });
  }

  // Sustained work over real days is the hardest thing to fake.
  if (editDays >= 2) flags.push({ level: 'ok', text: `Worked across ${editDays} days, sustained effort is hard to fake.` });

  const score = Math.max(0, 100 - penalty);
  const verdict = score >= 75 ? 'Revisions look authentic' : score >= 45 ? 'Some signs of gaming' : 'Likely manufactured';
  const color = score >= 75 ? '#6ee7b7' : score >= 45 ? '#fbbf24' : '#f87171';
  return { score, verdict, color, flags };
}

/**
 * Rubric-process alignment (OPTIONAL, professor-facing). Reads the rubric the
 * professor pastes and reports how the observed writing *process* lines up with
 * what each criterion rewards, a second opinion that points at evidence, never
 * a grade. DEMO (current): per-criterion alignment + notes derived heuristically
 * from the captured signals, fully client-side. The real Claude Agent SDK version
 * (subscription-authed) is parked at future/rubric-analyze.ts, to go live, run it
 * via Vercel Sandbox and POST { rubric, process } to it from runAlignment.
 */
type RubricRow = { criterion: string; note: string; alignment?: 'strong' | 'partial' | 'weak' | 'unclear' };

function parseRubric(text: string): string[] {
  return text
    .split(/\n+/)
    .map((l) => l.replace(/^\s*(\d+[.)]|[-*•])\s*/, '').trim())
    .filter(Boolean)
    .slice(0, 8);
}

function buildRubricAlignment(rubricText: string, proof: ExtensionProof) {
  const criteria = parseRubric(rubricText);
  const m = proof.metrics || {};
  const rev = proof.revision || null;
  const docs = proof.docsRevision || null;

  const editEvents = rev?.editCount || 0;
  const editDays = docs?.editDays || 0;
  const revisions = docs?.revisionCount || 0;
  const typedPct = Math.round((typeof m.humanTypedRatio === 'number' ? m.humanTypedRatio : (rev ? rev.humanTypedRatio : 1)) * 100);
  const bigPastes = m.bigPastes || 0;
  const backspaces = m.backspaceCount || 0;
  const processSummary = `${revisions || editEvents} revisions · ${editDays <= 1 ? '1 day' : `${editDays} days`} · ${typedPct}% typed`;

  const revDepth = (revisions || editEvents);
  const rows: RubricRow[] = criteria.map((c) => {
    const t = c.toLowerCase();
    let note: string;
    let alignment: NonNullable<RubricRow['alignment']>;
    if (/revis|draft|edit|rewrit|process/.test(t)) {
      note = `${revDepth} revisions over ${editDays <= 1 ? 'one session' : `${editDays} days`}, direct evidence of iterative work toward this.`;
      alignment = revDepth >= 8 || editDays >= 2 ? 'strong' : revDepth >= 2 ? 'partial' : 'weak';
    } else if (/evidence|research|source|cite|quote|reference/.test(t)) {
      note = bigPastes > 0
        ? `Pasted material present, could be quoted sources, but confirm it’s cited and not lifted whole.`
        : `Little was pasted in, so any sources were re-expressed in the student’s own typing.`;
      alignment = bigPastes > 0 ? 'partial' : 'strong';
    } else if (/grammar|clarity|style|proofread|mechanic|polish/.test(t)) {
      note = backspaces > 0
        ? `Frequent deletions and rewrites suggest real proofreading and polishing.`
        : `Few corrections captured, light evidence of a proofreading pass.`;
      alignment = backspaces > 20 ? 'strong' : backspaces > 0 ? 'partial' : 'weak';
    } else if (/thesis|argument|structure|organiz|coheren|flow/.test(t)) {
      note = `Revision history shows the piece was reworked, not written in one pass, consistent with developing structure.`;
      alignment = revDepth >= 5 ? 'strong' : revDepth >= 1 ? 'partial' : 'unclear';
    } else {
      note = `Process check: ${processSummary}. Use alongside your own read of the content.`;
      alignment = 'unclear';
    }
    return { criterion: c, note, alignment };
  });

  const summary = `The writing process (${processSummary}) ${typedPct >= 85 && bigPastes === 0 ? 'is consistent with original, iterative work toward this rubric.' : 'shows some shortcuts, review the flagged criteria before relying on it.'}`;
  return { rows, summary };
}

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

  return (
    <div style={styles.wrap}>
      <h1 style={styles.h1}>{success ? '✓ Proof published' : 'Proof of human writing'}</h1>
      <p style={styles.muted}>
        Captured by the Human Ink extension{proof.context === 'google-docs' ? ' from Google Docs' : ''}
        {proof.email ? ` · ${proof.email}` : ''}.{SIMULATE ? ' Demo, simulated on-chain write.' : ''}
      </p>

      {/* F2, two DECOUPLED metrics side by side. The Process Score is our own
          integrity measure; the AI probability is a separate post-hoc reference.
          They are never blended (a detector false-positive can't move the score). */}
      <div style={styles.heroRow}>
        <div style={{ ...styles.heroCard, borderColor: band.color, margin: 0 }}>
          <div style={styles.heroHead}>
            <span style={styles.heroLabel}>Process Score</span>
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
            <span style={styles.heroLabel}>AI probability <span style={styles.tag}>simulated</span></span>
            <span style={{ ...styles.heroNum, color: ai.color }}>{ai.ai}%</span>
          </div>
          <div style={styles.barWrap}>
            <div style={{ ...styles.barFill, width: `${ai.ai}%`, background: ai.color }} />
          </div>
          <p style={styles.reasonLine}>Independent post-hoc detector, a parallel reference, not part of the Process Score.</p>
        </div>
      </div>

      <button style={styles.seeWhy} onClick={() => setShowEvidence((v) => !v)}>
        {showEvidence ? 'Hide evidence ▲' : 'See why ▼'}
      </button>

      {showEvidence && (
      <>
      {/* What the Process Score is made of, the signal breakdown */}
      <div style={styles.card}>
        <div style={styles.signalHead}>What the Process Score is made of</div>
        <div style={styles.signalList}>
          {authorship.signals.map((s) => (
            <div key={s.key} style={{ ...styles.signal, opacity: s.has ? 1 : 0.45 }}>
              <div style={styles.signalTop}>
                <span style={styles.signalLabel}>{s.label}</span>
                <span style={styles.signalDetail}>{s.has ? s.detail : 'no data'}</span>
              </div>
              <div style={styles.signalBarWrap}>
                <div style={{ ...styles.signalBarFill, width: `${s.has ? s.score : 0}%` }} />
              </div>
              <p style={styles.signalBlurb}>{s.blurb}</p>
            </div>
          ))}
        </div>
        {authorship.protections.length > 0 && (
          <div style={{ ...styles.flagList, marginTop: 12 }}>
            {authorship.protections.map((p, i) => (
              <div key={i} style={styles.flag}>
                <span style={{ ...styles.flagDot, color: '#6ee7b7' }}>✓</span>
                <span style={styles.flagText}>{p}</span>
              </div>
            ))}
          </div>
        )}
      </div>

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

      {/* Captured behavioral metrics */}
      <div style={styles.grid}>
        <Stat k={m.wpm ?? 0} l="WPM" />
        <Stat k={m.keystrokeCount ?? proof.keystrokeCount} l="keystrokes" />
        <Stat k={m.backspaceCount ?? 0} l="backspaces" />
        <Stat k={proof.docsRevision?.revisionCount ?? proof.revision?.editCount ?? 0} l="revisions" />
        <Stat k={m.pasteCount ?? 0} l="pastes" />
        <Stat k={m.bigPastes ?? 0} l="big pastes" warn={(m.bigPastes ?? 0) > 0} />
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

      {/* Revision analysis, edit timeline reconstructed from the capture */}
      {proof.revision && proof.revision.editCount > 0 && (() => {
        const rev = proof.revision!;
        return (
          <div style={styles.card}>
            <div style={styles.sec}>Revision analysis</div>
            {rev.timeline && rev.timeline.length > 0 && (
              <WritingTimelineChart timeline={rev.timeline} docs={proof.docsRevision} />
            )}
            {rev.timeline && rev.timeline.length > 0 && (
              <>
                <div style={{ ...styles.sec, marginTop: 4 }}>Burst sizes</div>
                <BurstChart timeline={rev.timeline} />
              </>
            )}
            <Row k="Edit events" v={String(rev.editCount)} />
            <Row k="Typing bursts" v={String(rev.typedEdits)} />
            {rev.pasteEdits > 0 && <Row k="Paste insertions" v={String(rev.pasteEdits)} />}
            {rev.timeline && rev.timeline.length > 0 && (
              <div style={styles.timeline}>
                {rev.timeline.map((e, i) => {
                  const chipStyle = e.type !== 'paste' ? styles.chipType
                    : e.origin === 'internal_move' ? styles.chipMove
                    : e.origin === 'cited_source' ? styles.chipCited
                    : styles.chipPaste;
                  const icon = e.type !== 'paste' ? '⌨'
                    : e.origin === 'internal_move' ? '↔'
                    : e.origin === 'cited_source' ? '“”'
                    : '📋';
                  return (
                    <span key={i} style={{ ...styles.chip, ...chipStyle }}>{`${icon} ${e.chars}`}</span>
                  );
                })}
              </div>
            )}
          </div>
        );
      })()}
      </div>{/* end bodyGrid */}

      {/* For professors, optional rubric → AI-assisted process alignment */}
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

      </>
      )}

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
  timeline: { type: 'type' | 'paste'; chars: number; origin?: PasteOrigin }[];
  docs?: ExtensionProof['docsRevision'];
}) {
  const W = 320, H = 132, padL = 6, padR = 6, padT = 10, padB = 22;
  const innerW = W - padL - padR, innerH = H - padT - padB;

  // Cumulative document size, seeded with a 0 baseline so the curve starts at the floor.
  const cum: number[] = [0];
  for (const e of timeline) cum.push(cum[cum.length - 1] + Math.max(0, e.chars));
  const total = cum[cum.length - 1] || 1;
  const n = cum.length;
  const x = (i: number) => padL + (n <= 1 ? 0 : (i / (n - 1)) * innerW);
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
  const startLabel = fmtDate(docs?.firstModified) || 'start';
  const endLabel = fmtDate(docs?.lastModified) || 'finish';

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
        <line x1={padL} y1={baseY} x2={W - padR} y2={baseY} stroke="rgba(255,255,255,0.12)" strokeWidth={1} />
        <text x={padL} y={H - 6} fill="rgba(255,255,255,0.55)" fontSize={9}>{startLabel}</text>
        <text x={W - padR} y={H - 6} fill="rgba(255,255,255,0.55)" fontSize={9} textAnchor="end">{endLabel}</text>
        <text x={padL} y={padT + 2} fill="rgba(255,255,255,0.45)" fontSize={9}>{total.toLocaleString()} chars</text>
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
}: {
  timeline: { type: 'type' | 'paste'; chars: number; origin?: PasteOrigin }[];
}) {
  const W = 320, H = 96, padT = 8, padB = 16, padL = 6, padR = 6;
  const innerW = W - padL - padR, innerH = H - padT - padB;
  const n = timeline.length;
  const max = Math.max(1, ...timeline.map((e) => e.chars));
  const gap = n > 60 ? 0.5 : 2;
  const bw = n > 0 ? Math.max(1, (innerW - gap * (n - 1)) / n) : innerW;

  const TYPE = '#6ee7b7', EXTERNAL = '#fbbf24', MOVE = '#60a5fa', CITED = '#a78bfa';
  const color = (e: { type: string; origin?: PasteOrigin }) =>
    e.type !== 'paste' ? TYPE
      : e.origin === 'internal_move' ? MOVE
      : e.origin === 'cited_source' ? CITED
      : EXTERNAL;

  return (
    <div style={{ margin: '4px 0 12px' }}>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ display: 'block' }}>
        {timeline.map((e, i) => {
          const h = Math.max(2, (e.chars / max) * innerH);
          const x = padL + i * (bw + gap);
          const y = padT + innerH - h;
          return <rect key={i} x={x.toFixed(1)} y={y.toFixed(1)} width={bw.toFixed(1)} height={h.toFixed(1)} rx={1} fill={color(e)} />;
        })}
        <line x1={padL} y1={padT + innerH} x2={W - padR} y2={padT + innerH} stroke="rgba(255,255,255,0.12)" strokeWidth={1} />
        <text x={padL} y={H - 4} fill="rgba(255,255,255,0.5)" fontSize={9}>{n} bursts</text>
        <text x={W - padR} y={H - 4} fill="rgba(255,255,255,0.5)" fontSize={9} textAnchor="end">largest {max.toLocaleString()} chars</text>
      </svg>
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
  wrap: { maxWidth: 'min(1040px, 94vw)', margin: '32px auto', padding: '0 20px', color: 'inherit' },
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
  rubricRow: { padding: '8px 0', borderTop: '1px solid rgba(255,255,255,0.08)' },
  rubricCrit: { fontSize: 13, fontWeight: 600, marginBottom: 2, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  alignTag: { fontSize: 9, textTransform: 'uppercase', letterSpacing: 0.5, borderRadius: 4, padding: '1px 5px' },
  rubricNote: { fontSize: 12, opacity: 0.7, lineHeight: 1.4 },
};
