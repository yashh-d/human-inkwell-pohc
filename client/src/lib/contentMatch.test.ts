import { createHash } from 'crypto';
import { sha256Hex } from './sha256';
import {
  normalizeDocumentText,
  splitPassages,
  fingerprintDocument,
  compareToFingerprint,
  prepareProofForStorage,
  storedAiResult,
  DOCUMENT_MATCH_THRESHOLD,
} from './contentMatch';
import { computeAuthorshipScore, computeIntegrity, ExtensionProof } from './authorship';

// ---------- a realistic essay: 40 sentences in 6 paragraphs, Docs-style CRLF ----------
const TOPICS = ['the four-day week', 'teacher retention', 'student sleep', 'transport costs', 'childcare', 'test scores'];
const SENTENCES: string[] = [];
for (let i = 0; i < 40; i++) {
  const t = TOPICS[i % TOPICS.length];
  const tail = i % 7 === 0
    ? `“the evidence on ${t} is thinner than its advocates admit” — a point worth sitting with`
    : i % 5 === 0
      ? `districts that tried it report mixed results on ${t}, and the mixed part matters`
      : `a careful reading of ${t} suggests the schedule change is doing less work than the staffing change`;
  SENTENCES.push(`Sentence ${i + 1} argues that ${tail}.`);
}
const PARAS: string[] = [];
for (let p = 0; p < 6; p++) PARAS.push(SENTENCES.slice(p * 7, p * 7 + 7).join(' '));
const ESSAY = PARAS.join('\r\n\r\n');

const proofWith = (raw: string): Pick<ExtensionProof, 'contentFingerprint' | 'contentHash'> => ({
  contentFingerprint: fingerprintDocument(raw),
  contentHash: sha256Hex(raw),
});

function ok(r: ReturnType<typeof compareToFingerprint>) {
  if (!r.available) throw new Error(`not available: ${r.reason}`);
  return r;
}

// ---------- sha256 ----------
describe('sha256Hex', () => {
  it('matches the published test vectors', () => {
    expect(sha256Hex('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    expect(sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });
  it('agrees with node crypto on multi-byte and multi-block input', () => {
    const inputs = ['café naïve — “quoted” \u{1F600}', ESSAY, 'x'.repeat(55), 'y'.repeat(64), 'z'.repeat(1000)];
    for (const s of inputs) {
      expect(sha256Hex(s)).toBe(createHash('sha256').update(s, 'utf8').digest('hex'));
    }
  });
});

// ---------- normalisation ----------
describe('normalizeDocumentText', () => {
  it('strips every form of the Human Ink link and its label line', () => {
    const variants = [
      `${ESSAY}\r\n\r\nhttps://www.humanink.xyz/s/KPKXDJG8F7`,
      `${ESSAY}\n\nhumanink.xyz/s/KPKXDJG8F7`,
      `${ESSAY}\n\nHuman Ink proof:\nhttps://humanink.xyz/s/KPKXDJG8F7\n`,
      `${ESSAY}\n\nMy Human Ink proof: https://www.humanink.xyz/s/KPKXDJG8F7`,
      `${ESSAY} https://www.humanink.xyz/s/KPKXDJG8F7`,
    ];
    const base = normalizeDocumentText(ESSAY).text;
    for (const v of variants) {
      const n = normalizeDocumentText(v);
      expect(n.removedLinks).toBe(1);
      expect(splitPassages(n.text).map((p) => p.key)).toEqual(splitPassages(base).map((p) => p.key));
    }
  });
  it('keeps a sentence that merely mentions the site inside prose', () => {
    const n = normalizeDocumentText('I verified my work with the tool at humanink.xyz because my professor asked for it, and it worked.');
    expect(n.removedLinks).toBe(1);
    expect(splitPassages(n.text)).toHaveLength(1);
  });
});

describe('splitPassages', () => {
  it('cuts at terminators and line breaks, not inside numbers', () => {
    const p = splitPassages('Heading\nFirst one. Second costs 3.5 million! Third?\nFourth without a period');
    expect(p.map((x) => x.key)).toEqual([
      'heading', 'first one', 'second costs 3 5 million', 'third', 'fourth without a period',
    ]);
  });
});

// ---------- the check itself ----------
describe('compareToFingerprint', () => {
  it('is 100 and exact for the identical text', () => {
    const r = ok(compareToFingerprint(ESSAY, proofWith(ESSAY)));
    expect(r.coverage).toBe(100);
    expect(r.extra).toBe(0);
    expect(r.exact).toBe(true);
    expect(r.missingPassages).toBe(0);
    expect(r.unmatched).toHaveLength(0);
    expect(r.proofPassages).toBe(40);
  });

  it('is 100 after the student appends their Human Ink link', () => {
    const r = ok(compareToFingerprint(`${ESSAY}\n\nhttps://www.humanink.xyz/s/KPKXDJG8F7\n`, proofWith(ESSAY)));
    expect(r.coverage).toBe(100);
    expect(r.removedLinks).toBe(1);
    expect(r.exact).toBe(false);
  });

  it('ignores spacing, line endings, case, curly quotes, dashes and invisible characters', () => {
    const mangled = ESSAY
      .replace(/\r\n/g, '\n')
      .replace(/ /g, '  ')
      .replace(/“/g, '"').replace(/”/g, '"')
      .replace(/—/g, '-')
      .toUpperCase()
      .replace(/SENTENCE/g, '\u200BSENTENCE')
      + '\n\n\n';
    const r = ok(compareToFingerprint(mangled, proofWith(ESSAY)));
    expect(r.coverage).toBe(100);
    expect(r.exact).toBe(false);
  });

  it('tolerates a pasted copy that lost its paragraph breaks', () => {
    const r = ok(compareToFingerprint(ESSAY.replace(/\r\n\r\n/g, ' '), proofWith(ESSAY)));
    expect(r.coverage).toBe(100);
  });

  it('charges exactly one passage for one edited sentence', () => {
    const edited = ESSAY.replace('Sentence 12 argues', 'Sentence 12 now claims');
    const r = ok(compareToFingerprint(edited, proofWith(ESSAY)));
    expect(r.missingPassages).toBe(1);
    expect(r.unmatched).toHaveLength(1);
    expect(r.unmatched[0].text).toMatch(/^Sentence 12 now claims/);
    expect(r.coverage).toBeGreaterThan(96);
    expect(r.coverage).toBeLessThan(100);
    expect(r.color).toBe('#6ee7b7');
  });

  it('counts a header the student added as extra, not as a mismatch', () => {
    const withHeader = `John Doe\nProfessor Xavier\nPersuasive Essay\n19 October 2026\n\n${ESSAY}`;
    const r = ok(compareToFingerprint(withHeader, proofWith(ESSAY)));
    expect(r.coverage).toBe(100);
    expect(r.unmatched).toHaveLength(4);
    expect(r.extra).toBeGreaterThan(0);
    expect(r.extra).toBeLessThan(5);
  });

  it('drops below the threshold when a fifth of the essay is rewritten', () => {
    let rewritten = ESSAY;
    for (let i = 1; i <= 8; i++) rewritten = rewritten.replace(`Sentence ${i} argues`, `Sentence ${i} was rewritten to argue`);
    const r = ok(compareToFingerprint(rewritten, proofWith(ESSAY)));
    expect(r.coverage).toBeLessThan(DOCUMENT_MATCH_THRESHOLD);
    expect(r.missingPassages).toBe(8);
    expect(r.unmatched).toHaveLength(8);
  });

  it('is near zero for a different document', () => {
    const other = SENTENCES.map((s) => s.replace('argues', 'denies')).join(' ');
    const r = ok(compareToFingerprint(other, proofWith(ESSAY)));
    expect(r.coverage).toBeLessThan(5);
    expect(r.color).toBe('#f87171');
  });

  it('needs each repeated sentence as many times as the proof has it', () => {
    const doubled = `${ESSAY}\r\n\r\n${SENTENCES[3]}`;
    const r = ok(compareToFingerprint(ESSAY, proofWith(doubled)));
    expect(r.missingPassages).toBe(1);
    expect(r.coverage).toBeLessThan(100);
  });

  it('reports unavailable without a fingerprint', () => {
    const r = compareToFingerprint(ESSAY, { contentFingerprint: null, contentHash: sha256Hex(ESSAY) });
    expect(r.available).toBe(false);
  });
});

// ---------- storage shape: the text leaves, the score does not move ----------
function syntheticProof(text: string): ExtensionProof {
  const timeline: { t: number; type: 'type' | 'paste'; chars: number; origin?: 'cited_source' }[] = [];
  let t = Date.UTC(2026, 9, 10, 18, 0, 0);
  for (let i = 0; i < 80; i++) {
    const chars = 40 + ((i * 37) % 90);
    timeline.push({ t, type: 'type', chars });
    t += chars * 190 + 2000 + ((i * 7919) % 50000);
    if (i === 39) t += 20 * 3600000; // next day
  }
  return {
    v: 1,
    source: 'extension',
    context: 'google-docs',
    contentHash: sha256Hex(text),
    humanSignatureHash: 'f'.repeat(64),
    keystrokeCount: 6000,
    typingSpeed: 2,
    text,
    metrics: {
      wpm: 18, sessions: 2, days: 2, bigPastes: 0, elapsedMs: 60 * 60000, totalMs: 95 * 60000,
      pasteCount: 0, textLength: 0, pastedChars: 0, largestPaste: 0, backspaceCount: 420,
      keystrokeCount: 6000, humanTypedRatio: 1,
    },
    revision: {
      timeline, editCount: 80, typedEdits: 80, pasteEdits: 0, relocatedBursts: 9,
      typedChars: 5580, pastedChars: 0, externalPastedChars: 0, internalPastedChars: 0,
      citedPastedChars: 0, largestPaste: 0, largestExternalPaste: 0, humanTypedRatio: 1,
    },
    docsRevision: null,
  } as ExtensionProof;
}

describe('prepareProofForStorage', () => {
  it('removes the text, adds the fingerprint, and leaves every score unchanged', () => {
    const before = syntheticProof(ESSAY);
    const after = prepareProofForStorage(before, { ai: 7, human: 93, color: '#6ee7b7', pastedRatio: 0, source: 'model' });

    expect(after.text).toBeUndefined();
    expect(before.text).toBe(ESSAY); // input untouched
    expect(after.contentFingerprint?.count).toBe(40);
    expect(after.metrics?.textLength).toBe(ESSAY.length);
    expect(after.metrics?.wordCount).toBe(ESSAY.trim().split(/\s+/).length);
    expect(after.aiDetection?.ai).toBe(7);

    expect(computeAuthorshipScore(after).score).toBe(computeAuthorshipScore(before).score);
    expect(computeIntegrity(after).score).toBe(computeIntegrity(before).score);
    expect(computeAuthorshipScore(after).dimensions.map((d) => d.score))
      .toEqual(computeAuthorshipScore(before).dimensions.map((d) => d.score));

    // and the stored fingerprint still recognises the original text
    expect(ok(compareToFingerprint(ESSAY, after)).coverage).toBe(100);
  });

  it('does not freeze a heuristic AI result, only a model one', () => {
    const p = prepareProofForStorage(syntheticProof(ESSAY), { ai: 7, human: 93, color: '', pastedRatio: 0, source: 'fallback' });
    expect(p.aiDetection).toBeUndefined();
  });

  it('storedAiResult reproduces the frozen model number for a stored proof', () => {
    const p = prepareProofForStorage(syntheticProof(ESSAY), { ai: 7, human: 93, color: '', pastedRatio: 0, source: 'model' });
    const r = storedAiResult(p);
    expect(r?.ai).toBe(7);
    expect(r?.source).toBe('model');
    expect(storedAiResult(syntheticProof(ESSAY))).toBeNull(); // live text present: no freeze
  });
});
