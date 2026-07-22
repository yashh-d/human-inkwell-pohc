/**
 * receipts.ts — descriptive "receipts" for a piece of writing (the creator model).
 *
 * Per the creator spec: RECEIPTS, NOT SCORES. No composite grade, no negative /
 * detection stat — only descriptive facts about how the work was made, the kind a
 * writer is proud to show readers (Strava, not Duolingo). Computed from the same
 * captured proof the report already uses; framework-free so the Craft Card, the
 * feed and the profile can all read the same numbers.
 *
 * The kill ratio (words composed ÷ words published) is the headline: writers are
 * proud of cutting, and it can't be faked by padding time.
 */
import { ExtensionProof, pasteBreakdown } from './authorship';

export type Receipts = {
  activeSeconds: number;   // idle-trimmed composition time
  sessions: number;        // distinct writing sittings (1 for a single editor session)
  keystrokes: number;
  wordsTyped: number;      // gross words composed (incl. what was later cut)
  wordsPublished: number;  // words in the final piece
  killRatio: number;       // wordsTyped / wordsPublished (≥1 means they cut)
  revisions: number;       // editing passes / saved revisions
  wpm: number;             // headline typing pace
  wpmSeries: number[];     // downsampled cadence for the sparkline (per-burst intensity)
  editDays: number;        // distinct days the work spanned
  pastedWords: number;     // words pasted in from outside (for the typed-vs-pasted receipt)
};

/** Small, sparkline-friendly series (≤ N points) from the burst timeline. */
function downsampleCadence(proof: ExtensionProof, points = 24): number[] {
  const timeline = proof.revision?.timeline || [];
  const typed = timeline.filter((e) => e.type === 'type').map((e) => Math.max(0, e.chars));
  if (typed.length === 0) return [];
  if (typed.length <= points) return typed;
  // Bucket into `points` bins, summing chars per bin.
  const out: number[] = new Array(points).fill(0);
  for (let i = 0; i < typed.length; i++) {
    out[Math.min(points - 1, Math.floor((i / typed.length) * points))] += typed[i];
  }
  return out;
}

export function computeReceipts(proof: ExtensionProof): Receipts {
  const m = proof.metrics || {};
  const rev = proof.revision || null;
  const docs = proof.docsRevision || null;
  const pb = pasteBreakdown(proof);

  const activeSeconds = Math.round((m.elapsedMs || 0) / 1000);
  const editDays = docs?.editDays || (activeSeconds > 0 ? 1 : 0);
  // Sessions: for Docs capture, distinct days is the best proxy we have; for the
  // single-shot editor it's one sitting.
  const sessions = Math.max(1, docs?.editDays || 1);

  const keystrokes = m.keystrokeCount || proof.keystrokeCount || 0;
  const backspaces = m.backspaceCount || 0;
  const publishedChars = m.textLength || pb.typedChars || 0;
  // Gross composed chars ≈ what survived + what was deleted (each backspace ate a char).
  const grossChars = Math.max(publishedChars, publishedChars + backspaces);

  const wordsPublished = Math.round(publishedChars / 5);
  const wordsTyped = Math.round(grossChars / 5);
  const killRatio = wordsPublished > 0 ? Math.round((wordsTyped / wordsPublished) * 100) / 100 : 1;

  const revisions = (docs?.revisionCount || 0) || (rev?.editCount || 0);
  const pastedWords = Math.round((pb.externalChars || 0) / 5);

  return {
    activeSeconds,
    sessions,
    keystrokes,
    wordsTyped,
    wordsPublished,
    killRatio,
    revisions,
    wpm: m.wpm || 0,
    wpmSeries: downsampleCadence(proof),
    editDays,
    pastedWords,
  };
}

/** "6h 40m" / "42m" / "38s" — human duration for the active-time receipt. */
export function fmtDuration(seconds: number): string {
  if (!seconds || seconds < 1) return '0s';
  const h = Math.floor(seconds / 3600);
  const mm = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}h ${mm}m`;
  if (mm > 0) return `${mm}m${s ? ` ${s}s` : ''}`;
  return `${s}s`;
}
