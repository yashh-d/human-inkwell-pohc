/**
 * authorship.ts — the single source of truth for Human Ink's writing-process
 * scoring. Pure, framework-free functions shared by every surface that reads a
 * captured proof: the professor/student report (/publish), the creator report
 * (/creator), and the embeddable badge (/badge).
 *
 * Nothing here touches React, the DOM, styles, or the network. It takes an
 * ExtensionProof (captured by the Human Ink Chrome extension) and turns it into
 * scores, bands, evidence and plain-English verdicts. Keep it that way so any
 * new surface can import a number without pulling in a page.
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
  elapsedMs?: number;
  textLength?: number;
};

export type PasteOrigin = 'internal_move' | 'cited_source' | 'external';
export type RevisionAnalysis = {
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
  timeline?: { type: 'type' | 'paste'; chars: number; origin?: PasteOrigin; t?: number }[];
};

export type ExtensionProof = {
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
  const verdict = ai < 30 ? 'Likely human' : ai <= 70 ? 'Mixed signals' : 'Likely AI-assisted';
  const color = ai < 30 ? '#6ee7b7' : ai <= 70 ? '#fbbf24' : '#f87171';
  return { ai, human, verdict, color, pastedRatio };
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
 * Human Authorship Score, the one number a reader takes in at a glance.
 *
 * Built from the signals that matter most, in priority order: revision depth
 * (the fingerprint of real effort, you cannot fake drafts), writing-vs-pasting,
 * time invested, and editing-over-time. Each signal is normalized 0–100,
 * weighted, and rolled into one score. Signals with no data are dropped and the
 * remaining weights re-normalized, so the score is always honest about what it
 * actually saw.
 */
export type AuthorshipSignal = {
  key: string;
  label: string;
  blurb: string;        // one-liner
  score: number;        // 0–100
  weight: number;
  detail: string;       // human-readable value
  has: boolean;         // did we actually capture this?
};

export function computeAuthorshipScore(proof: ExtensionProof) {
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
  // These guard honest writers.
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
export type ScoreBands = { green: number; red: number };
export const DEFAULT_BANDS: ScoreBands = { green: 60, red: 30 };
export function processBand(score: number, bands: ScoreBands) {
  if (score >= bands.green) return { label: 'Authentic, clear to move on', color: '#6ee7b7', tone: 'green' as const };
  if (score >= bands.red) return { label: 'Worth a glance', color: '#fbbf24', tone: 'yellow' as const };
  return { label: 'Investigate', color: '#f87171', tone: 'red' as const };
}

/** One plain-English line under the Process Score, the "why" for a clean essay. */
export function reasonLine(proof: ExtensionProof, score: number): string {
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
 */
export type IntegrityFlag = { level: 'ok' | 'warn' | 'bad'; text: string };

export function computeIntegrity(proof: ExtensionProof) {
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
 * Rubric-process alignment (OPTIONAL, professor-facing). Reads a pasted rubric and
 * reports how the observed writing *process* lines up with what each criterion
 * rewards. A second opinion that points at evidence, never a grade.
 */
export type RubricRow = { criterion: string; note: string; alignment?: 'strong' | 'partial' | 'weak' | 'unclear' };

export function parseRubric(text: string): string[] {
  return text
    .split(/\n+/)
    .map((l) => l.replace(/^\s*(\d+[.)]|[-*•])\s*/, '').trim())
    .filter(Boolean)
    .slice(0, 8);
}

export function buildRubricAlignment(rubricText: string, proof: ExtensionProof) {
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
