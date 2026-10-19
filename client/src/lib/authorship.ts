/**
 * authorship.ts — the single source of truth for Human Ink's writing-process
 * scoring. Pure, framework-free functions shared by every surface that reads a
 * captured proof: the professor/student report (/publish), the creator report
 * (/creator), and the embeddable badge (/badge).
 *
 * Nothing here touches React, the DOM, styles, or the network. It takes an
 * ExtensionProof (captured by the Human Ink Chrome extension) and turns it into
 * scores, bands and plain-English evidence. Keep it that way so any new surface
 * can import a number without pulling in a page.
 *
 * It deliberately issues no verdicts. Every function returns measurements, the
 * arithmetic behind them, and a colour — never a word like "Authentic" or
 * "Investigate". Naming the conclusion is the reader's job, not ours.
 */

export type ProofMetrics = {
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
  /** ACTIVE writing time across every session — idle and hidden-tab time excluded. */
  elapsedMs?: number;
  /** TOTAL wall-clock time spent in the document across every session. */
  totalMs?: number;
  /** First session start → last session end. */
  spanMs?: number;
  /** Distinct calendar days the writer worked on this document. */
  days?: number;
  /** Number of separate sittings. */
  sessions?: number;
  textLength?: number;
  /** Word count of the finished text, recorded at publish time because the text itself is not stored. */
  wordCount?: number;
};

/**
 * Privacy-preserving fingerprint of the finished document: one truncated SHA-256
 * per normalised passage (a sentence, or a line with no terminator), in document
 * order, with each passage's normalised length. It lets a professor check that
 * the text they received is the text that was proven without the text itself
 * ever being stored: recovering a passage from its hash means guessing the whole
 * passage. Built and compared only in lib/contentMatch.ts, where the
 * normalisation lives.
 */
export type ContentFingerprint = {
  v: number;
  algo: 'sha256-64';
  unit: 'passage';
  /** Normalisation revision. A fingerprint is only comparable under the revision that built it. */
  norm: number;
  count: number;
  totalChars: number;
  hashes: string[];
  chars: number[];
};

export type PasteOrigin = 'internal_move' | 'cited_source' | 'external';
export type RevisionAnalysis = {
  editCount: number;
  typedEdits: number;
  pasteEdits: number;
  // Typing bursts that resumed after the writer went BACK somewhere in the document
  // (clicked into the text, or jumped by line/page) rather than continuing from
  // where the last burst stopped — the "writers rarely compose start to finish"
  // signal. A count only: the extension never records WHERE anything happened.
  // Absent on payloads captured before this shipped.
  relocatedBursts?: number;
  typedChars: number;
  pastedChars: number;
  // F1 provenance breakdown (older payloads won't have these).
  externalPastedChars?: number;
  internalPastedChars?: number;
  citedPastedChars?: number;
  largestExternalPaste?: number;
  humanTypedRatio: number;
  largestPaste: number;
  timeline?: { type: 'type' | 'paste'; chars: number; origin?: PasteOrigin; t?: number }[];
};

export type ExtensionProof = {
  v: number;
  source: string;
  contentHash: string;
  // Passage fingerprint of the finished text, for the professor's document check.
  // Stored in place of the text itself; absent on proofs published before it existed.
  contentFingerprint?: ContentFingerprint | null;
  // The AI detector's result at publish time, kept so the report shows the same
  // number the roster stored instead of re-scoring text that is no longer carried.
  aiDetection?: {
    ai: number;
    human: number;
    source: 'model';
    at: string;
    // Set when scored on the server (/api/submission-ai): whether SHA-256(text)
    // matched the attested content_hash, and which worker backend produced it.
    hashVerified?: boolean | null;
    backend?: string | null;
  } | null;
  // Raw written text (web capture only), carried so /publish can run a real
  // AI-text detector on the same text contentHash attests. Absent for Docs and
  // for older/privacy hand-offs — the detector falls back to the metrics score.
  text?: string;
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
    // Google's own record of how text entered the document across its WHOLE life,
    // including before the extension was installed. largestInsert is the biggest
    // single insertion ever made — the check on whether a finished draft was
    // dropped in off-camera.
    largestInsert?: number;
    pasteRevisions?: number;
    authors: string[];
  } | null;
  // Tracking-off disclosure: whether (and for how long) the writer toggled live
  // capture OFF. Transparency only — the Google revision scan is toggle-independent,
  // so pausing can't hide pasted text; older hand-offs won't carry this.
  pause?: {
    everPaused: boolean;
    currentlyPaused: boolean;
    pauseCount: number;
    pausedMs: number;
    pauses: { start: number; end: number }[];
  } | null;
};

export const PROOF_KEY = 'humanink_pending_proof';

function b64urlDecode(s: string): string {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/');
  const pad = b64.length % 4 ? '='.repeat(4 - (b64.length % 4)) : '';
  return decodeURIComponent(escape(atob(b64 + pad)));
}

/**
 * Read a captured proof from the URL hash (?proof=<base64url json>) — how the
 * extension hands off — falling back to the sessionStorage copy on a reload.
 */
export function loadProof(): { proof?: ExtensionProof; error?: string } {
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

export const short = (h?: string | null) => (h ? `${h.slice(0, 10)}…${h.slice(-8)}` : '-');

export const fmtMs = (ms?: number) => {
  if (!ms) return '0s';
  const s = Math.round(ms / 1000);
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
};

/**
 * Simulated AI-detection score (stand-in for GPT Zero / an AI-detector API).
 * For the demo this is driven mainly by the copy-paste signal: the more of the
 * text arrived as large pastes vs. typed keystrokes, the more "AI-assisted".
 */
export function computeAiScore(m: ProofMetrics) {
  const humanRatio = typeof m.humanTypedRatio === 'number' ? m.humanTypedRatio : 1;
  const pastedRatio = Math.max(0, Math.min(1, 1 - humanRatio));
  let ai = pastedRatio * 100;
  if ((m.bigPastes || 0) > 0) ai += Math.min(30, (m.bigPastes || 0) * 15);
  // Natural editing (backspaces) at a human cadence nudges back toward human.
  if ((m.backspaceCount || 0) > 0 && (m.wpm || 0) >= 15 && (m.wpm || 0) <= 110) ai -= 8;
  ai = Math.max(1, Math.min(99, Math.round(ai)));
  const human = 100 - ai;
  const color = ai < 30 ? '#6ee7b7' : ai <= 70 ? '#fbbf24' : '#f87171';
  return { ai, human, color, pastedRatio };
}

/**
 * F1 paste picture, the single source of truth for "what counts against you".
 * Only EXTERNAL pastes (came from outside the doc) count; cut-and-move of your own
 * text and quoted/cited material do not. A grace budget absorbs legitimate offline
 * drafting (a paragraph written on a phone, an imported outline) before any penalty.
 * Falls back gracefully for older payloads that predate provenance (all pastes
 * treated as external, no grace beyond the floor).
 */
export function pasteBreakdown(proof: ExtensionProof) {
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
 * PROCESS SCORE — the one number a professor takes in at a glance.
 *
 * Reads on a traditional 100-point grading scale, because that is the scale
 * professors already have instincts for: anything above 70 is where honest work
 * lands, and below 60 genuinely warrants a conversation.
 *
 * The model scores the WRITING PROCESS across three weighted dimensions. Each
 * dimension is judged 0–100 on its own, then blended:
 *
 *     Process Score = 0.50 · Revision density
 *                   + 0.30 · Generative velocity
 *                   + 0.20 · Temporal distribution
 *
 * Honest work lands above 70. 60–70 is worth a glance. Below 60 is a real flag.
 *
 * Each dimension is calibrated so that ORDINARY behaviour scores well and only
 * genuinely anomalous behaviour scores badly. Writing in one sitting is normal,
 * not suspicious; it simply doesn't reach the top of the temporal band.
 *
 * ── 1. REVISION DENSITY — 50%, the strongest signal ──────────────────────
 * Text composed in a word processor is subject to far more revision than text
 * composed any other way. The tool invites cutting, deleting and reworking, so
 * a genuine draft is messy: you write a clause, dislike it, take it back out.
 * Transcription — whether from an AI tab or a printed page — is not messy.
 *
 *   • Backspace ratio: deletions as a share of keystrokes. Around 9% is
 *     ordinary drafting and scores full marks. Near-zero over a long document
 *     is the single most telling thing in the whole record.
 *   • Burst depth: how many distinct typing bursts built the piece, measured
 *     against its length (a burst ends after a 2-second pause). Stop-think-type
 *     is what composition looks like. Google Docs saved revisions, when we have
 *     them, count double — that log is written by Google, not by the writer.
 *
 *   • Non-linear editing: the share of typing bursts that resumed somewhere the
 *     writer had gone BACK to, rather than carrying on from the end. Credit
 *     only — earning it lifts the score, not earning it costs nothing, because
 *     some people genuinely do write in order.
 *
 * ── 2. GENERATIVE VELOCITY — 30% ─────────────────────────────────────────
 * How the text appeared on screen. Net composition speed is far slower than
 * raw typing speed: under exam conditions students average roughly 800 words
 * an hour, about 13 net words a minute. Words written track fluency of thought,
 * not finger speed. So the curve is flat and free up to 40 wpm — three times
 * that baseline, covering any genuinely fast writer — and only then bends.
 *
 *   • Sustained rate: finished words per minute of ACTIVE writing time (idle
 *     gaps and hidden-tab time removed). A 1,000-word essay appearing in five
 *     minutes is 200 wpm, which is not composition by anyone.
 *   • Burst rhythm: humans type a sentence, stop for thirty seconds to read or
 *     think, then type again. Variance in burst size and real pauses between
 *     bursts read as human; a flat, uniform stream does not.
 *
 * ── 3. TEMPORAL DISTRIBUTION — 20% ───────────────────────────────────────
 *   • Spread: separate sittings, and separate days. Sustained engagement is
 *     the hardest part of a writing process to fabricate after the fact.
 *   • Active-time ratio: time actively writing vs. time the document was open.
 *     A person may have a document open three hours and type for forty-five
 *     minutes — that gap is thinking, and it reads as human. A ratio near 1.0,
 *     every second in the document spent typing, does not.
 *
 * ── WHAT WE DID NOT WATCH IS NOT ITS OWN DIMENSION ───────────────────────
 * There used to be a fourth dimension scoring how much of the finished piece we
 * observed arriving. It was removed: it read 100/100 for the overwhelming
 * majority of documents, so it functioned as a flat bonus that compressed the
 * three measures that actually discriminate. Unobserved text still registers —
 * it registers where it belongs. Revision behaviour cannot be read from text
 * that was never typed in front of us, so the revision dimension scales down by
 * the observed share; and pace is measured over the words that appeared in our
 * window when Google's own changelog independently accounts for the rest.
 *
 * ── LENGTH IS NOT QUALITY ────────────────────────────────────────────────
 * Every length-sensitive measure is normalised against the finished word count
 * rather than rewarding raw volume — slightly shorter essays tend to score
 * better than very long ones, and a big word count is not itself evidence of
 * anything. Short pieces are also exempt from pace judgement entirely.
 *
 * ── PASTING IS TRACKED IN FULL, AND NEVER PENALIZED ──────────────────────
 * Not at all, in any amount. There are too many honest reasons to paste:
 * quoting a source, pulling in your own notes, moving a paragraph, recovering
 * a draft off your phone. Penalizing the paste itself punished ordinary
 * research writing and taught students to retype quotations by hand.
 *
 * Every pasted character is still counted, disclosed beside the score and
 * broken down by origin in the report — because a professor should see it.
 * It just never subtracts. And it cannot hide anything either: pasted text
 * arrives instantly, so it adds length without adding writing time, revision
 * or bursts. An essay that arrived whole has no process to show, which the
 * first three dimensions register on their own. A student who pastes three
 * quotations into an essay they spent an hour on still has an hour of writing
 * time, an hour of revision, and loses nothing at all for the pasting.
 */

/** Clamp to the 0–100 range every dimension reports on. */
const clamp100 = (x: number) => Math.max(0, Math.min(100, x));

/** Piecewise-linear interpolation through (input, output) knots. */
function curve(x: number, knots: [number, number][]): number {
  if (x <= knots[0][0]) return knots[0][1];
  for (let i = 1; i < knots.length; i++) {
    const [x0, y0] = knots[i - 1];
    const [x1, y1] = knots[i];
    if (x <= x1) return y0 + ((x - x0) / (x1 - x0)) * (y1 - y0);
  }
  return knots[knots.length - 1][1];
}

/** Net composition pace → 0–100. Free through 40 wpm; a real question past 70.
 *  Anchored on the ~13 net wpm students actually average on academic writing. */
const RATE_CURVE: [number, number][] = [
  [0, 100], [40, 100], [70, 80], [100, 45], [160, 15], [300, 0],
];

/** Deletions per keystroke → 0–100. ~9% is ordinary drafting; near-zero is not. */
function backspaceScore(ratio: number): number {
  return ratio <= 0.005
    ? clamp100(25 * (ratio / 0.005))
    : clamp100(25 + 75 * Math.min(1, (ratio - 0.005) / 0.085));
}

/**
 * Burst rhythm from the captured edit timeline: does the typing come in bursts
 * that VARY, the way a person writes — a clause, a pause to read it back, a
 * longer run, a stop to think — or in a flat, uniform stream?
 *
 * Measured as variance, deliberately. Each timeline entry carries the burst's
 * START time, so the gap between entries bundles typing time together with the
 * pause after it, and the two cannot be separated without knowing this writer's
 * true in-burst speed. Variance needs no such assumption: however you split it,
 * a human's bursts are irregular in both size and spacing, and a transcription
 * is regular in both.
 *
 * Returns null when there aren't enough bursts to say anything, so a missing or
 * thin timeline never costs a writer points.
 */
function burstRhythm(timeline?: RevisionAnalysis['timeline']) {
  const bursts = (timeline || []).filter((e) => e.type === 'type' && typeof e.t === 'number');
  if (bursts.length < 8) return null;
  const gaps: number[] = [];
  for (let i = 1; i < bursts.length; i++) {
    const g = (bursts[i].t as number) - (bursts[i - 1].t as number);
    if (g > 0 && g < 60 * 60000) gaps.push(g);
  }
  if (gaps.length < 6) return null;
  const mean = (a: number[]) => a.reduce((s, x) => s + x, 0) / a.length;
  const cv = (a: number[]) => {
    const m = mean(a);
    return m > 0 ? Math.sqrt(mean(a.map((x) => (x - m) ** 2))) / m : 0;
  };
  const gapCv = cv(gaps);
  const sizeCv = cv(bursts.map((b) => b.chars || 0));
  const score = clamp100(30 + 40 * Math.min(1, gapCv / 0.7) + 30 * Math.min(1, sizeCv / 0.55));
  return { score, bursts: bursts.length, gapCv, sizeCv };
}

/** One evidence signal. DISPLAY ONLY — these describe the work, they do not score it. */
export type AuthorshipSignal = {
  key: string;
  label: string;
  blurb: string;        // one-liner
  score: number;        // 0–100 strength, for the evidence bars only
  detail: string;       // human-readable value
  has: boolean;         // did we actually capture this?
};

/** One line of the score arithmetic: points a dimension left on the table, and why. */
export type ScoreDeduction = {
  key: string;
  label: string;        // short, professor-readable
  points: number;       // positive number of points removed
  detail: string;       // the specific observation behind it
};

/** One of the four weighted dimensions the Process Score is built from. */
export type ScoreDimension = {
  key: string;
  label: string;
  weight: number;       // share of the final score, 0–1
  score: number;        // 0–100 for this dimension on its own
  points: number;       // weight × score — what it contributed
  max: number;          // weight × 100 — the most it could contribute
  detail: string;       // one line a professor can read aloud
  parts: { label: string; detail: string }[]; // the measurements behind it
};

/** The weights, in one place. Must sum to 1. */
export const SCORE_WEIGHTS = {
  revision: 0.50,
  velocity: 0.30,
  temporal: 0.20,
} as const;

export const SCORE_EXPLAINER =
  'The Process Score reads the writing process across three weighted dimensions. Revision density (50%) is the strongest signal — deletions, rewrites, distinct typing bursts and returning to earlier text, because composing in a word processor is messy and transcription is not. Generative velocity (30%) asks how the text appeared: net composition pace against active writing time, and whether the typing came in human bursts with real pauses. Temporal distribution (20%) rewards work spread across sittings and days, and treats thinking time in an open document as human. Pasting is counted and shown in full detail, but never subtracts — it simply adds length without adding writing time, revision or bursts, so an essay that arrived whole has no process to show.';

export function computeAuthorshipScore(proof: ExtensionProof) {
  const m = proof.metrics || {};
  const rev = proof.revision || null;
  const docs = proof.docsRevision || null;
  const pb = pasteBreakdown(proof);

  const protections: string[] = [];
  const n = (x: number) => Math.round(x).toLocaleString();

  const keystrokes = m.keystrokeCount || proof.keystrokeCount || 0;
  const backspaces = m.backspaceCount || 0;

  // ── THE TWO CLOCKS ───────────────────────────────────────────────────────
  // ACTIVE: keystroke-to-keystroke with idle gaps and hidden-tab time removed.
  // TOTAL:  plain wall clock in the document. Never less than active.
  const activeMin = Math.max(0, (m.elapsedMs || 0) / 60000);
  const totalMin = Math.max(activeMin, (m.totalMs || 0) / 60000);
  const sessions = Math.max(1, m.sessions || 1);
  // Distinct calendar days worked. Prefer Google's revision history when it is
  // available; otherwise the extension's own per-document day count.
  const editDays = Math.max(1, docs?.editDays || m.days || 1);
  const spanDays = Math.max(editDays, docs?.spanDays || 0);

  // ── THE LENGTH ───────────────────────────────────────────────────────────
  // Real word count when we carried the text, otherwise chars/5 (the standard
  // word-equivalent, and how WPM has always been defined).
  const finalLength = (typeof proof.text === 'string' ? proof.text.length : 0) || m.textLength || 0;
  const accounted = Math.max(pb.totalChars, keystrokes);
  // The text is not stored, so a stored proof carries the count it had at publish
  // time instead (metrics.wordCount, set by prepareProofForStorage). Same number
  // either way, which is what keeps the roster and the report in agreement.
  const words = typeof proof.text === 'string' && proof.text.trim()
    ? proof.text.trim().split(/\s+/).length
    : (m.wordCount || Math.round((finalLength || accounted) / 5));

  // Short pieces are never judged on pace — a 200-word reading response written
  // briskly is not evidence of anything. Full weight only from 400 words up.
  const sizeFactor = words <= 150 ? 0 : Math.min(1, (words - 150) / 250);

  const savedRevisions = docs?.revisionCount || 0;
  const editEvents = rev?.editCount || 0;

  // ═══ 1. REVISION DENSITY — 40% ═══════════════════════════════════════════
  // The strongest signal we have. Composing in a word processor is messy;
  // transcribing something that already exists is not.
  const revParts: { label: string; detail: string }[] = [];

  // (a) Backspace ratio. ~9% of keystrokes being corrections is ordinary
  //     drafting. Needs enough typing to mean anything at all.
  //
  //     The denominator must be PRINTABLE characters. The extension used to report
  //     typedChars as its raw keydown count — every Shift, Ctrl, arrow, Tab and
  //     Enter included — which inflated it 15-25% and quietly deflated this ratio
  //     on the dimension carrying the most weight. Newer payloads send the printable
  //     count; on older ones the two are identical, which is how we tell them apart.
  const typedBasis = rev && rev.typedChars > 0 && rev.typedChars < keystrokes
    ? rev.typedChars
    : keystrokes;
  const editRatio = typedBasis > 0 ? backspaces / typedBasis : 0;
  const enoughTyping = typedBasis >= 300;
  const bsScore = enoughTyping ? backspaceScore(editRatio) : 60;
  revParts.push({
    label: 'Deletions and rewrites',
    detail: enoughTyping
      ? `${n(backspaces)} deletions across ${n(typedBasis)} typed characters — ${(editRatio * 100).toFixed(1)}% of the writing here was the writer correcting themselves. Ordinary drafting runs about 9%.`
      : `Only ${n(typedBasis)} characters were typed in this document — too few to read a revision pattern from.`,
  });

  // (b) Burst depth. A burst ends after a 2-second pause, so this counts the
  //     stop-think-type cycles that built the piece — measured AGAINST its
  //     length, so a long document earns nothing for being long. Google Docs
  //     saved revisions count double: that log is written by Google, not the writer.
  const expectedBursts = Math.max(6, words / 50);
  const historyDepth = editEvents + 2 * savedRevisions;
  // Distinguish "no bursts happened" from "no burst data was captured". Older
  // hand-offs predate the edit timeline, and a missing record is not evidence.
  const hasBurstData = !!rev || savedRevisions > 0;
  const depthScore = hasBurstData
    ? clamp100(40 + 60 * Math.min(1, historyDepth / expectedBursts))
    : 70;
  revParts.push({
    label: 'Distinct edit bursts',
    detail: !hasBurstData
      ? 'This capture predates the edit timeline, so the burst structure of the writing was never recorded. Treated as unknown, not as absent.'
      : savedRevisions > 0
        ? `${n(editEvents)} typing bursts captured here plus ${n(savedRevisions)} saved revisions in the Google Docs history (counted double), against roughly ${n(expectedBursts)} expected for ${n(words)} words.`
        : `${n(editEvents)} distinct typing bursts built this piece, against roughly ${n(expectedBursts)} expected for ${n(words)} words.`,
  });

  // How much of the finished document was typed here at all. This is NOT a
  // paste penalty — it is the honest observation that revision density cannot
  // be read from text that was never typed in front of us.
  const typedShare = finalLength > 0 ? Math.min(1, pb.typedChars / finalLength) : 1;
  const observedFactor = typedShare >= 0.25 ? 1 : typedShare / 0.25;
  if (observedFactor < 1) {
    revParts.push({
      label: 'Limited typing to read',
      detail: `Only ${Math.round(typedShare * 100)}% of the finished document was typed in this window, so there is little revision behaviour to measure. Not a penalty for pasting — pasted text simply carries no revision record with it.`,
    });
  }

  // (c) Non-linear composition. Writers rarely go start to finish; they draft, go
  //     back to an earlier paragraph, rework it, and carry on. A pasted or retyped
  //     draft only ever grows at the end.
  //
  //     CREDIT ONLY, and deliberately so. Its absence is not evidence: some people
  //     genuinely do write in order, and a writer who navigates by mouse-wheel and
  //     retypes rather than clicking would score zero here while doing honest work.
  //     Earning it lifts the score; not earning it costs nothing. That also means
  //     no student is ever accused on the strength of a signal this indirect.
  const typedBursts = rev?.typedEdits || 0;
  const relocBursts = typeof rev?.relocatedBursts === 'number' ? rev.relocatedBursts : null;
  const hasReloc = relocBursts !== null && typedBursts >= 8;
  const relocRate = hasReloc ? relocBursts! / typedBursts : 0;
  const relocCredit = hasReloc ? 12 * Math.min(1, relocRate / 0.25) : 0;
  if (relocCredit > 1) {
    revParts.push({
      label: 'Went back and reworked',
      detail: `About ${Math.round(relocRate * 100)}% of the typing here picked up somewhere the writer had returned to, rather than carrying on from the end. Writing a document out of order is characteristic of composing it; transcribing something finished runs front to back.`,
    });
  }
  const revisionScoreDim = clamp100((0.55 * bsScore + 0.45 * depthScore + relocCredit) * observedFactor);

  // ═══ 2. GENERATIVE VELOCITY — 30% ════════════════════════════════════════
  // How the text appeared on screen: sustained pace, and the rhythm of it.
  const velParts: { label: string; detail: string }[] = [];

  // Pace has to be measured over the words we actually watched appear. If a student
  // drafted for three days and only THEN installed the extension, dividing the whole
  // finished document by our nine-minute window reports a pace nobody could type —
  // an artefact of when we started watching, not of how the piece was written.
  //
  // We only make that allowance when Google's own changelog corroborates it on two
  // counts: it must show edit days we never saw, AND show no single insertion large
  // enough to be a finished draft dropped in. Both are required. Without the
  // changelog nothing changes, so a document quietly pre-loaded off-camera earns no
  // relief — the whole point of the second condition is that pasting an essay before
  // installing still leaves Google's fingerprint on it.
  const witnessedChars = pb.typedChars + pb.externalChars + pb.internalChars + pb.citedChars;
  const preExisting = Math.max(0, finalLength - witnessedChars);
  const docsShowsPriorWork = !!docs
    && (docs.editDays || 0) > (m.days || 1)
    && (docs.largestInsert || 0) < 1000;
  const witnessedShare = finalLength > 0 ? Math.min(1, witnessedChars / finalLength) : 1;
  const rateWords = docsShowsPriorWork && preExisting > 0 ? words * witnessedShare : words;
  const rate = activeMin > 0.25 ? rateWords / activeMin : Infinity;
  const rateScore = isFinite(rate) ? curve(rate, RATE_CURVE) : (words >= 60 ? 0 : 100);
  velParts.push({
    label: 'Net composition pace',
    detail: !isFinite(rate)
      ? `${n(words)} words with essentially no writing time recorded in this document.`
      : rateWords < words
        ? `Google's revision history shows this document was already being written on ${n(docs!.editDays || 0)} separate days before this record begins, with no single insertion big enough to be a pasted draft. Pace is therefore measured over the ${n(Math.round(rateWords))} words that appeared here — ${Math.round(rate)} per active minute — not the whole finished piece.`
        : `${n(words)} words across ${activeMin < 1 ? 'under a minute' : `${Math.round(activeMin)} minutes`} of active writing — ${Math.round(rate)} words per active minute. Students average roughly 13 on academic writing; anything up to 40 is free here.`,
  });

  const rhythm = burstRhythm(rev?.timeline);
  if (rhythm) {
    const irregular = rhythm.gapCv >= 0.5 || rhythm.sizeCv >= 0.4;
    velParts.push({
      label: 'Burst rhythm',
      detail: irregular
        ? `${n(rhythm.bursts)} typing bursts, irregular in both size and spacing — a clause, a pause to read it back, a longer run. That unevenness is what composing looks like.`
        : `${n(rhythm.bursts)} typing bursts of near-identical size and spacing. Composing is uneven; a steady, uniform stream is what transcribing looks like.`,
    });
  }
  const rawVelocity = rhythm ? 0.75 * rateScore + 0.25 * rhythm.score : rateScore;
  // Short pieces are exempt from pace judgement entirely.
  const velocityScoreDim = clamp100(100 - (100 - rawVelocity) * sizeFactor);

  // ═══ 3. TEMPORAL DISTRIBUTION — 20% ══════════════════════════════════════
  const tempParts: { label: string; detail: string }[] = [];
  // One sitting is normal and is not an accusation — it just doesn't reach the
  // top of the band. Short pieces start higher, since nobody spreads a
  // discussion post across three days.
  const spread = clamp100(60 + 25 * (1 - sizeFactor)
    + 12 * Math.min(2, sessions - 1) + 14 * Math.min(2, editDays - 1));
  tempParts.push({
    label: 'Spread of the work',
    detail: editDays > 1
      ? `Written across ${editDays} separate days in ${sessions} sittings. Sustained engagement is the hardest part of a writing process to fabricate.`
      : sessions > 1
        ? `Written in ${sessions} separate sittings on one day.`
        : 'Written in a single sitting. Normal, and not counted against anyone — it simply shows less of the process than work picked back up later.',
  });

  // Active vs. total: a person may have a document open for three hours and
  // type for forty-five minutes. That gap is thinking, and it reads as human.
  // Meaningless over very short windows, so only read past ten minutes.
  const hasRatio = (m.totalMs || 0) > 0 && totalMin >= 10;
  const activeRatio = totalMin > 0 ? Math.min(1, activeMin / totalMin) : 1;
  const ratioScore = curve(activeRatio, [[0, 100], [0.7, 100], [0.95, 70], [1, 60]]);
  if (hasRatio) {
    tempParts.push({
      label: 'Thinking time',
      detail: `${Math.round(activeMin)} minutes actively writing out of ${Math.round(totalMin)} minutes with the document open — ${Math.round(activeRatio * 100)}% of the time in the document was spent typing. ${
        activeRatio <= 0.7
          ? 'The rest is reading and thinking, which is what writing looks like.'
          : activeRatio <= 0.9
            ? 'That leaves a normal amount of time reading and thinking.'
            : 'Almost every second in the document was spent typing, with barely a pause to think.'}`,
    });
  }
  const temporalScoreDim = clamp100(hasRatio ? 0.65 * spread + 0.35 * ratioScore : spread);

  // How much of the finished piece we actually watched being produced. NOT a
  // dimension of its own — it read 100/100 for almost every document, so it acted
  // as a flat bonus rather than a measurement. Kept as a disclosure figure, and it
  // already does real work inside the other dimensions: revision scales by the
  // observed share, and pace is measured over the observed words when Google's
  // changelog independently accounts for the rest.
  const coverage = finalLength > 0
    ? Math.max(0, Math.min(1, accounted / finalLength))
    : null;

  // ═══ THE BLEND ═══════════════════════════════════════════════════════════
  const dimensions: ScoreDimension[] = [
    {
      key: 'revision', label: 'Revision density', weight: SCORE_WEIGHTS.revision,
      score: Math.round(revisionScoreDim),
      points: SCORE_WEIGHTS.revision * revisionScoreDim, max: SCORE_WEIGHTS.revision * 100,
      detail: 'Deletions, rewrites and distinct edit bursts. Composing in a word processor is messy; transcription is not.',
      parts: revParts,
    },
    {
      key: 'velocity', label: 'Generative velocity', weight: SCORE_WEIGHTS.velocity,
      score: Math.round(velocityScoreDim),
      points: SCORE_WEIGHTS.velocity * velocityScoreDim, max: SCORE_WEIGHTS.velocity * 100,
      detail: 'How the text appeared: net composition pace against active writing time, and whether it came in human bursts.',
      parts: velParts,
    },
    {
      key: 'temporal', label: 'Temporal distribution', weight: SCORE_WEIGHTS.temporal,
      score: Math.round(temporalScoreDim),
      points: SCORE_WEIGHTS.temporal * temporalScoreDim, max: SCORE_WEIGHTS.temporal * 100,
      detail: 'Sittings, days, and how much of the time in the document was thinking rather than typing.',
      parts: tempParts,
    },
  ];

  // The same arithmetic stated subtractively, for the breakdown table: what each
  // dimension left on the table, and why. Reconciles exactly with the total.
  const deductions: ScoreDeduction[] = dimensions
    .map((d) => ({
      key: d.key,
      label: `${d.label} — ${d.score}/100`,
      points: Math.round(d.max - d.points),
      detail: d.parts.map((p) => p.detail).join(' '),
    }))
    .filter((d) => d.points > 0);

  // ── What we deliberately did not count ───────────────────────────────────
  // Pasting, in every form. Shown here so the professor can see it was seen.
  if (pb.externalChars > 0) {
    protections.push(`${n(pb.externalChars)} characters were pasted in from outside. Not deducted — there are too many honest reasons to paste, and pasted text adds length without adding writing time, so it is already accounted for above.`);
  }
  // Text the writer cut and repositioned inside their own document is editing,
  // not pasting. It is counted as theirs in the scoring above and is not called
  // out here — naming it invites suspicion of something entirely ordinary.
  if (pb.citedChars > 0) {
    protections.push(`${n(pb.citedChars)} characters were quoted from a cited source.`);
  }
  if (editDays <= 1 && sessions <= 1) {
    protections.push('Written in a single sitting. Normal, and never treated as suspicious on its own — it simply shows less of the process than work picked back up over days.');
  }
  if (words >= 60 && sizeFactor === 0) {
    protections.push('Short piece — too short to judge on writing pace, so composition speed was not scored.');
  }
  if (isFinite(rate) && rate <= 40 && activeMin >= 1 && sizeFactor > 0) {
    protections.push(`${Math.round(rate)} words per active minute over ${Math.round(activeMin)} minutes — a normal composing pace. Writing quickly costs nothing.`);
  }

  // ── THE ONE HARD CONSTRAINT ──────────────────────────────────────────────
  // The blend is a weighted opinion; composition speed is a physical fact. A
  // person cannot produce 1,000 finished words in eight minutes, and no amount
  // of revision texture or day-spreading explains it away — so when velocity
  // collapses, it puts a ceiling on the whole score rather than being averaged
  // out by the other three. Only ever binds below 60, i.e. past ~95 words per
  // active minute, which is already well beyond a fast writer.
  const blended = dimensions.reduce((s, d) => s + d.points, 0);
  const ceiling = velocityScoreDim < 60 ? 50 + velocityScoreDim * 0.5 : 100;
  if (blended > ceiling) {
    protections.push(`Capped at ${Math.round(ceiling)} by composition speed: ${Math.round(rate)} words per active minute cannot be produced by a person, and the rest of the record cannot outweigh that.`);
  }
  const score = Math.round(clamp100(Math.min(blended, ceiling)));
  const totalDeduction = 100 - score;

  // ── Evidence, shown beside the score (never scored) ──────────────────────
  const revisionScore = Math.min(100, savedRevisions * 4 + editEvents * 3);
  // The time bar reads against what this particular piece needed, not a flat
  // 30 minutes: a 300-word response and a 3,000-word paper are not the same job.
  // "Enough" is words/25 — an unhurried composing pace.
  const neededMin = Math.max(5, words / 25);
  const timeScore = Math.min(100, Math.round((activeMin / neededMin) * 100));
  const overTimeScore = Math.min(100, Math.round(((editDays - 1) / 3) * 70 + Math.min(30, (sessions - 1) * 15)));
  // Plain, honest share of the finished document that was typed in front of us.
  // No grace budgets, no ratios that hide pasting — it simply isn't deducted.
  const typedScore = Math.round(Math.max(0, Math.min(1,
    pb.typedChars / Math.max(finalLength || pb.totalChars, 1))) * 100);
  const typedDetail = pb.externalChars > 0
    ? `${typedScore}% typed here · ${n(pb.externalChars)} chars pasted`
    : `${typedScore}% typed`;

  const signals: AuthorshipSignal[] = [
    {
      key: 'revision',
      label: 'Revision depth',
      blurb: 'Drafts, rewrites and edits. Evidence of how the piece was built — a revision history is very hard to fabricate.',
      score: revisionScore,
      detail: savedRevisions ? `${savedRevisions} saved revisions · ${editEvents} edits` : `${editEvents} edit events`,
      has: savedRevisions > 0 || editEvents > 0,
    },
    {
      key: 'typed',
      label: 'Typed in this document',
      blurb: 'How much of the finished text was typed here rather than arriving already written. Context only — pasting is never deducted.',
      score: typedScore,
      detail: typedDetail,
      has: typeof m.humanTypedRatio === 'number' || !!rev,
    },
    {
      key: 'time',
      label: 'Time invested',
      blurb: 'Active writing time with idle gaps excluded, weighed against the length of the finished piece. This is what the score is built on.',
      score: timeScore,
      detail: fmtMs(m.elapsedMs),
      has: (m.elapsedMs || 0) > 0,
    },
    {
      key: 'time-span',
      label: 'Editing over time',
      blurb: 'How many days and sittings the work spanned. Sustained work raises confidence; one sitting is not held against anyone.',
      score: overTimeScore,
      detail: editDays <= 1
        ? (sessions > 1 ? `${sessions} sittings, 1 day` : '1 sitting')
        : `${editDays} days${spanDays > editDays ? ` (over ${spanDays})` : ''}`,
      has: editDays > 0,
    },
  ];

  // Share of the finished document actually typed in front of us. NOT scored —
  // pasting costs nothing — and NOT surfaced in the report; available to callers
  // that want it. Kept because "the time adds up" and "we watched it being
  // written" are different claims, and the second one has a number.
  const typedCoverage = finalLength > 0 ? Math.min(1, pb.typedChars / finalLength) : null;

  const color = score >= 90 ? '#6ee7b7' : score >= 80 ? '#a7f3d0' : score >= 70 ? '#fbbf24' : '#f87171';

  // Retained for older callers: a rough "how much process did we see" index.
  // Informational only — it no longer moves the score in either direction.
  const effortIndex = Math.round((revisionScore + timeScore + overTimeScore) / 3);

  return {
    score, color, signals, dimensions, deductions, protections, coverage, effortIndex,
    totalDeduction,
    // Measured inputs, exposed so the report can show the arithmetic.
    words, activeMin, totalMin, rate, editDays, sessions, typedCoverage,
    // Pasting: tracked in full, never scored. Surfaced so the report and the
    // overview can disclose exactly how much arrived from outside.
    pastedChars: pb.externalChars + pb.internalChars + pb.citedChars,
    externalPastedChars: pb.externalChars,
    internalPastedChars: pb.internalChars,
    citedPastedChars: pb.citedChars,
    largestPaste: pb.largestExternal,
  };
}

/**
 * The traffic-light band. Thresholds are server-tunable (see /api/scoring-config)
 * with these defaults: above 70 is green, 60–70 is yellow, and below 60 is a
 * genuine flag. The score is a rounded integer, so green starting at 71 is
 * exactly "above 70". A false green is a missed catch, but a false red is a
 * wrongful accusation — so red is reserved for scores well clear of the middle.
 *
 * Colour and tone only. The band deliberately carries no wording: a number on a
 * 100-point scale is a measurement the reader can argue with, and a word next to
 * it ("Authentic", "Investigate") is a conclusion drawn on their behalf.
 */
export type ScoreBands = { green: number; red: number };
export const DEFAULT_BANDS: ScoreBands = { green: 71, red: 60 };
export function processBand(score: number, bands: ScoreBands) {
  if (score >= bands.green) return { color: '#6ee7b7', tone: 'green' as const };
  if (score >= bands.red) return { color: '#fbbf24', tone: 'yellow' as const };
  return { color: '#f87171', tone: 'red' as const };
}

/**
 * One plain-English line under the Process Score. For a clean paper it says why
 * it's clean; otherwise it names the single biggest thing that took points off,
 * so the number is never unexplained.
 */
export function reasonLine(proof: ExtensionProof, score: number): string {
  const a = computeAuthorshipScore(proof);
  const { dimensions, words, activeMin, rate, editDays, sessions } = a;
  const mins = activeMin < 1 ? 'under a minute' : `${Math.round(activeMin)} minutes`;
  const wordStr = words.toLocaleString();

  // Below the green line, name the dimension that cost the most, so the number
  // is never unexplained. At or above it the paper is clean and the line should
  // say why — never hand a professor a complaint under a passing score.
  const weakest = dimensions.slice().sort((x, y) => (y.max - y.points) - (x.max - x.points))[0];
  if (score < DEFAULT_BANDS.green && weakest && weakest.max - weakest.points >= 4) {
    switch (weakest.key) {
      case 'velocity':
        return rate >= 160
          ? `${wordStr} words with ${mins} of writing time in this document. Whatever else is true, the writing did not happen here — ask the student where it did.`
          : `${wordStr} words with ${mins} of writing time — about ${Math.round(rate)} words per active minute, faster than a person composes new prose over this length.`;
      case 'revision':
        return `Almost no revising shows in this document: the text largely grew without being deleted, reworked or returned to. Composing in a word processor is normally messy.`;
      case 'temporal':
        return `The whole piece appeared in one uninterrupted stretch, with little pause between bursts — less of a writing process than most work of this length shows.`;
      default:
        break;
    }
  }
  if (score >= DEFAULT_BANDS.green) {
    return (editDays >= 2
      ? `${wordStr} words written here over ${editDays} days and ${sessions} sittings, revised as it went and at an ordinary composing pace.`
      : `${wordStr} words written here across ${mins} of actual writing time, revised as it went — an ordinary composing pace for this length.`);
  }
  return `Parts of the writing process happened outside this document.`;
}

/**
 * Revision authenticity, the anti-gaming check. Real, not simulated: it runs
 * entirely on signals we already captured. Genuine drafting leaves a messy
 * texture (deletions, rewrites, work spread across sittings); manufactured
 * revisions look the opposite, big pastes, monotonic growth, all in one go.
 */
export type IntegrityFlag = { level: 'ok' | 'warn' | 'bad'; text: string };

/**
 * The one-line explanation shown behind the ⓘ next to Revision authenticity, in
 * the report and on the professor dashboard. Lives here, beside the function it
 * describes, so the two can never drift apart. Keep it to a single sentence: it
 * has to fit a tooltip and a table header alike.
 */
export const INTEGRITY_INFO =
  'Starts at 100 and deducts for text that arrived faster than it could have been written, for revisions crammed into a single sitting, and for edits that never delete anything.';

export function computeIntegrity(proof: ExtensionProof) {
  const m = proof.metrics || {};
  const rev = proof.revision || null;
  const docs = proof.docsRevision || null;
  const flags: IntegrityFlag[] = [];

  const pb = pasteBreakdown(proof);
  const a = computeAuthorshipScore(proof);
  const editDays = a.editDays;
  const revisionCount = docs?.revisionCount || 0;
  const editEvents = rev?.editCount || 0;
  const keystrokes = m.keystrokeCount || proof.keystrokeCount || 0;
  const backspaces = m.backspaceCount || 0;

  let penalty = 0;

  // TIME vs. LENGTH — the same central question the Process Score asks, stated
  // as a revision-integrity flag. This is the only heavy penalty here.
  if (a.words >= 60 && isFinite(a.rate)) {
    if (a.rate >= 180) {
      flags.push({ level: 'bad', text: `${a.words.toLocaleString()} words against ${Math.round(a.activeMin)} minutes of writing time — the text did not originate in this document.` });
      penalty += 35;
    } else if (a.rate >= 120) {
      flags.push({ level: 'bad', text: `${Math.round(a.rate)} words per active minute sustained over this length — transcription pace, not composition.` });
      penalty += 25;
    } else if (a.rate >= 85) {
      flags.push({ level: 'warn', text: `${Math.round(a.rate)} words per active minute — unusually fast for composing new prose.` });
      penalty += 12;
    } else {
      flags.push({ level: 'ok', text: `${Math.round(a.rate)} words per active minute over ${Math.round(a.activeMin)} minutes — a normal composing pace.` });
    }
  } else if (a.words >= 60) {
    flags.push({ level: 'bad', text: 'No writing time was recorded for a document of this length.' });
    penalty += 35;
  }

  // PASTING — reported, never penalized. There are too many honest reasons to
  // paste, and pasted text already shows up above as length without writing time.
  if (pb.externalChars > 0) {
    flags.push({ level: 'ok', text: `${pb.externalChars} characters were pasted in from outside. Shown for context, not counted against the writer.` });
  }
  // Cut-and-reposition of the writer's own text is editing, not pasting, and is
  // deliberately not surfaced as its own flag.

  // Manufactured drafts: many revisions in one sitting AND a corroborating tell
  // (implausible pace, or growth with no deletions). Writing a paper in one
  // focused afternoon is normal and must never be flagged on its own — that
  // alone was the single biggest source of false warnings on honest work.
  const noTexture = keystrokes >= 500 && backspaces / keystrokes < 0.01;
  if ((revisionCount >= 6 || editEvents >= 12) && editDays <= 1 && (a.rate >= 120 || noTexture)) {
    flags.push({ level: 'warn', text: `${revisionCount || editEvents} revisions, all in one sitting, with no sign of the text being composed as it went.` });
    penalty += 15;
  }

  // Real revising deletes and rewrites; text that only ever grew is suspect.
  if (keystrokes > 500 && backspaces === 0) {
    flags.push({ level: 'warn', text: 'Revisions only added text, no deletions or rewrites, unusual for genuine editing.' });
    penalty += 15;
  } else if (backspaces > 0) {
    flags.push({ level: 'ok', text: 'Edits include deletions and rewrites, the texture of real revising.' });
  }

  // Sustained work over real days is the hardest thing to fake.
  if (editDays >= 2) flags.push({ level: 'ok', text: `Worked across ${editDays} days, sustained effort is hard to fake.` });
  else if (a.sessions >= 2) flags.push({ level: 'ok', text: `Returned to the document across ${a.sessions} separate sittings.` });

  const score = Math.max(0, 100 - penalty);
  const color = score >= 75 ? '#6ee7b7' : score >= 45 ? '#fbbf24' : '#f87171';
  return { score, color, flags };
}

