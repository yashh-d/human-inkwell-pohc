/**
 * DOCUMENT CHECK: is the text a professor was handed the text that was proven?
 *
 * The product never stores the student's text, only hashes of it, so "is this the
 * same document" cannot be answered with a diff. Instead, at publish time the
 * finished text is cut into passages (a sentence, or a line with no terminator),
 * each passage is normalised and hashed, and only the hashes travel with the
 * proof. Later the professor pastes whatever they received into the report; it is
 * cut and hashed the same way, and the two hash multisets are compared, weighted
 * by passage length. The pasted text never leaves the professor's browser either:
 * the whole comparison runs client-side.
 *
 * Normalisation is deliberately forgiving about everything that is not the words:
 * whitespace, line endings, curly quotes, dashes, case, punctuation, invisible
 * characters, and the Human Ink link students are told to paste under their
 * essay. Any change to it is a change to NORM_VERSION, because a fingerprint
 * built under one revision cannot be compared under another.
 *
 * What a fingerprint reveals: how many passages there are, their normalised
 * lengths, and their order. Recovering a passage means guessing it whole, so the
 * hashes confirm a sentence to someone who already has it and reveal nothing to
 * anyone else, the same property as the whole-document content hash.
 */
import { sha256Hex } from './sha256';
import { computeAiScore } from './authorship';
import type { ContentFingerprint, ExtensionProof } from './authorship';
import type { AiResult } from './aiDetector';

export const FINGERPRINT_VERSION = 1;
export const NORM_VERSION = 1;
/** Coverage at or above this reads green. Server-tunable later if it needs to be. */
export const DOCUMENT_MATCH_THRESHOLD = 97;
const AMBER_FLOOR = 90;

// The link students paste under their essay, in every form it shows up in.
const HUMAN_INK_LINK = /(?:https?:\/\/)?(?:www\.)?humanink\.xyz(?:\/[^\s)\]}>"'<]*)?/gi;
// A line that is nothing but a label for that link, when the link sits on the next line.
const LABEL_ONLY_LINES = new Set([
  'human ink', 'humanink', 'human ink proof', 'human ink link', 'human ink proof link',
  'proof', 'proof link', 'proof of human writing', 'my human ink proof', 'writing proof',
  'proof of writing', 'verified with human ink', 'human ink verification',
]);

// Characters that are not words. Written as escapes on purpose: an editor that
// "cleans up" invisible characters would otherwise silently change the regex.
const INVISIBLES = /[\uFEFF\u200B\u200C\u200D\u2060\u00AD]/g;   // BOM, zero-width, soft hyphen
const HARD_SPACES = /[\u00A0\u2007\u202F]/g;                       // non-breaking spaces
const SINGLE_QUOTES = /[\u2018\u2019\u201A\u201B\u2032\u2035]/g;
const DOUBLE_QUOTES = /[\u201C\u201D\u201E\u201F\u2033\u2036]/g;
const DASHES = /[\u2010-\u2015\u2212]/g;                           // hyphen variants, en, em, horizontal bar, minus
const ELLIPSIS = /\u2026/g;
const NOT_WORD = /[^\p{L}\p{N}]+/gu;

/**
 * Everything that is not the words, removed. Returns text with its original
 * casing and punctuation (for showing passages back to the reader) and the count
 * of Human Ink links that were stripped (so the report can say it ignored them).
 */
export function normalizeDocumentText(raw: string): { text: string; removedLinks: number } {
  let s = (raw || '').normalize('NFKC');
  s = s.replace(INVISIBLES, '');
  s = s.replace(HARD_SPACES, ' ');
  s = s.replace(SINGLE_QUOTES, "'");
  s = s.replace(DOUBLE_QUOTES, '"');
  s = s.replace(DASHES, '-');
  s = s.replace(ELLIPSIS, '...');
  s = s.replace(/\r\n?/g, '\n');

  let removedLinks = 0;
  const kept: string[] = [];
  for (const line of s.split('\n')) {
    const links = line.match(HUMAN_INK_LINK);
    const hadLink = !!links;
    if (links) removedLinks += links.length;
    const stripped = hadLink ? line.replace(HUMAN_INK_LINK, ' ') : line;
    const key = stripped.toLowerCase().replace(NOT_WORD, ' ').trim();
    if (!key) continue;                                          // blank, or was only the link
    if (hadLink && key.split(' ').length <= 8) continue;         // "My Human Ink proof: <link>"
    if (LABEL_ONLY_LINES.has(key)) continue;                     // "Human Ink proof:" above the link
    kept.push(stripped);
  }
  return { text: kept.join('\n'), removedLinks };
}

export type Passage = {
  /** Readable form, original casing and punctuation. Only ever shown back to the person who pasted it. */
  display: string;
  /** What gets hashed: lowercase letters and digits, single-spaced. */
  key: string;
};

/**
 * Cut normalised text into passages: at every sentence terminator followed by a
 * space, and at every line break. Headings and list items become their own
 * passages, so one edited sentence costs one passage and not a paragraph.
 */
export function splitPassages(text: string): Passage[] {
  const flat = text.replace(/[ \t\f\v]+/g, ' ');
  const marked = flat.replace(/([.!?]+["')\]]*) +/g, '$1\n');
  const out: Passage[] = [];
  for (const seg of marked.split(/\n+/)) {
    const display = seg.trim();
    const key = display.toLowerCase().replace(NOT_WORD, ' ').trim();
    if (key) out.push({ display, key });
  }
  return out;
}

const passageHash = (key: string) => sha256Hex(key).slice(0, 16);

export function fingerprintDocument(raw: string): ContentFingerprint {
  const passages = splitPassages(normalizeDocumentText(raw).text);
  const chars = passages.map((p) => p.key.length);
  return {
    v: FINGERPRINT_VERSION,
    algo: 'sha256-64',
    unit: 'passage',
    norm: NORM_VERSION,
    count: passages.length,
    totalChars: chars.reduce((a, b) => a + b, 0),
    hashes: passages.map((p) => passageHash(p.key)),
    chars,
  };
}

export type UnmatchedPassage = { text: string; chars: number };

export type DocumentMatch =
  | { available: false; reason: 'no-fingerprint' | 'incompatible' }
  | {
      available: true;
      /** Share of the proven document's characters found in the pasted text, 0-100, one decimal. */
      coverage: number;
      /** Share of the pasted text's characters that are not in the proven document, 0-100, one decimal. */
      extra: number;
      /** The pasted text hashes to the proof's content hash byte for byte. */
      exact: boolean;
      color: string;
      proofPassages: number;
      proofChars: number;
      submissionPassages: number;
      submissionChars: number;
      matchedPassages: number;
      /** Passages in the proof that the pasted text does not contain. Count only: their text is not stored. */
      missingPassages: number;
      /** Passages in the pasted text that are not in the proof. Shown back to the professor. */
      unmatched: UnmatchedPassage[];
      removedLinks: number;
    };

export function matchColor(coverage: number): string {
  return coverage >= DOCUMENT_MATCH_THRESHOLD ? '#6ee7b7' : coverage >= AMBER_FLOOR ? '#fbbf24' : '#f87171';
}

/** Byte-for-byte check against the whole-document hash, tolerant only of line-ending and trailing-whitespace drift. */
export function exactContentHashMatches(raw: string, contentHash?: string | null): boolean {
  if (!contentHash || !raw) return false;
  const want = contentHash.toLowerCase();
  const lf = raw.replace(/\r\n?/g, '\n');
  const crlf = lf.replace(/\n/g, '\r\n');
  const candidates = new Set<string>();
  for (const b of [raw, lf, crlf]) {
    const trimmed = b.replace(/\s+$/, '');
    candidates.add(b);
    candidates.add(trimmed);
    candidates.add(trimmed + '\n');
    candidates.add(trimmed + '\r\n');
  }
  // Array.from rather than for...of: the build target does not iterate a Set directly.
  const list = Array.from(candidates);
  for (let i = 0; i < list.length; i++) if (sha256Hex(list[i]) === want) return true;
  return false;
}

export function compareToFingerprint(
  raw: string,
  proof: Pick<ExtensionProof, 'contentFingerprint' | 'contentHash'>,
): DocumentMatch {
  const fp = proof.contentFingerprint;
  if (!fp || !Array.isArray(fp.hashes) || !Array.isArray(fp.chars)) return { available: false, reason: 'no-fingerprint' };
  if (fp.v !== FINGERPRINT_VERSION || fp.norm !== NORM_VERSION || fp.algo !== 'sha256-64') {
    return { available: false, reason: 'incompatible' };
  }

  const { text, removedLinks } = normalizeDocumentText(raw);
  const passages = splitPassages(text);

  // Multiset of what the proof contains. A sentence that appears twice in the
  // essay must appear twice in the submission to count twice.
  const remaining = new Map<string, { count: number; chars: number }>();
  fp.hashes.forEach((h, i) => {
    const e = remaining.get(h);
    if (e) e.count += 1;
    else remaining.set(h, { count: 1, chars: fp.chars[i] || 0 });
  });

  let matchedChars = 0;
  let matchedPassages = 0;
  const unmatched: UnmatchedPassage[] = [];
  for (const p of passages) {
    const e = remaining.get(passageHash(p.key));
    if (e && e.count > 0) {
      e.count -= 1;
      matchedChars += p.key.length;
      matchedPassages += 1;
    } else {
      unmatched.push({ text: p.display, chars: p.key.length });
    }
  }
  let missingPassages = 0;
  remaining.forEach((e) => { missingPassages += e.count; });

  const proofChars = fp.totalChars || fp.chars.reduce((a, b) => a + b, 0);
  const submissionChars = passages.reduce((s, p) => s + p.key.length, 0);
  const coverageRaw = proofChars > 0 ? Math.min(100, (matchedChars / proofChars) * 100) : 0;
  const extraRaw = submissionChars > 0 ? ((submissionChars - matchedChars) / submissionChars) * 100 : 0;
  const round1 = (x: number) => Math.round(x * 10) / 10;

  return {
    available: true,
    coverage: round1(coverageRaw),
    extra: round1(extraRaw),
    exact: exactContentHashMatches(raw, proof.contentHash),
    color: matchColor(coverageRaw),
    proofPassages: fp.count || fp.hashes.length,
    proofChars,
    submissionPassages: passages.length,
    submissionChars,
    matchedPassages,
    missingPassages,
    unmatched,
    removedLinks,
  };
}

/**
 * The proof as it is allowed to be stored. The extension hands /publish the full
 * text so the AI detector can score the same bytes the content hash attests, and
 * that text is transient: it must not reach the database. This replaces it with
 * everything the stored proof needs from it:
 *
 *   - contentFingerprint, for the professor's document check;
 *   - metrics.textLength and metrics.wordCount, which the Process Score reads
 *     from the text when it is present, so the stored score and the score the
 *     report re-derives from the stored blob stay identical;
 *   - aiDetection, the detector's result at publish time, so the report shows
 *     the number the roster stored instead of re-scoring text it no longer has.
 *     Only a real model result is kept; a heuristic fallback is reproducible
 *     from the metrics and is not worth freezing.
 */
export function prepareProofForStorage(proof: ExtensionProof, ai?: AiResult | null): ExtensionProof {
  const { text, ...rest } = proof;
  const out: ExtensionProof = { ...rest };
  if (typeof text === 'string' && text.trim()) {
    out.contentFingerprint = fingerprintDocument(text);
    out.metrics = {
      ...(proof.metrics || {}),
      textLength: text.length,
      wordCount: text.trim().split(/\s+/).length,
    };
  }
  if (ai && ai.source === 'model') {
    out.aiDetection = { ai: ai.ai, human: ai.human, source: 'model', at: new Date().toISOString() };
  }
  return out;
}

/** The AI number a stored proof should display, when it carries one and no text to re-score. */
export function storedAiResult(proof: ExtensionProof): AiResult | null {
  const d = proof.aiDetection;
  if (!d || typeof d.ai !== 'number') return null;
  if (typeof proof.text === 'string' && proof.text.trim()) return null; // live text wins
  const base = computeAiScore(proof.metrics || {});
  const ai = Math.max(1, Math.min(99, Math.round(d.ai)));
  const color = ai < 30 ? '#6ee7b7' : ai <= 70 ? '#fbbf24' : '#f87171';
  return { ...base, ai, human: 100 - ai, color, source: 'model' };
}
