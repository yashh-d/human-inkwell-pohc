/**
 * useLiveWritingCapture — the creator edition's *in-browser* writing tracker.
 *
 * The student flow captures writing via the Chrome extension inside Google Docs.
 * Creators write directly on /creator instead, so this hook does the same job on
 * a plain <textarea>: it records keystroke biometrics (via useKeystrokeCapture +
 * useBiometricProcessor), classifies pastes as external vs. within-doc moves, and
 * on finish() hashes the content and emits the exact same ExtensionProof shape
 * the scoring lib + publish flow already consume. No servers, no extension.
 */
import { useCallback, useRef } from 'react';
import { useKeystrokeCapture } from './useKeystrokeCapture';
import { useBiometricProcessor } from './useBiometricProcessor';
import { hashContent } from '../utils/crypto';
import { ExtensionProof, PasteOrigin } from '../lib/authorship';

const BIG_PASTE = 120;      // chars; matches the integrity "large block" threshold
const BURST_GAP_MS = 2000;  // a pause > 2s starts a new typing burst

type PasteRec = { chars: number; origin: PasteOrigin; t: number };
type TimelineEntry = { type: 'type' | 'paste'; chars: number; origin?: PasteOrigin; t: number };

export function useLiveWritingCapture() {
  const { startCapture, stopCapture, getRawKeystrokeData, getTabAwayCount, isCapturing } = useKeystrokeCapture();
  const { extractFeatures, generateHumanSignatureHash } = useBiometricProcessor();

  const firstInputRef = useRef<number | null>(null);
  const lastInputRef = useRef<number | null>(null);
  const pastesRef = useRef<PasteRec[]>([]);

  /** Attach capture to the editor element (call once it's mounted). */
  const attach = useCallback((el: HTMLElement) => { startCapture(el); }, [startCapture]);

  /** Call on every edit — stamps the active writing window. */
  const noteInput = useCallback(() => {
    const now = Date.now();
    if (firstInputRef.current == null) firstInputRef.current = now;
    lastInputRef.current = now;
  }, []);

  /** Record a paste, classifying it as a within-doc move or external material. */
  const notePaste = useCallback((pastedText: string, priorContent: string) => {
    const chars = pastedText.length;
    if (chars <= 0) return;
    const origin: PasteOrigin = priorContent.includes(pastedText.trim()) && pastedText.trim().length > 0
      ? 'internal_move'
      : 'external';
    pastesRef.current.push({ chars, origin, t: Date.now() });
    noteInput();
  }, [noteInput]);

  const reset = useCallback(() => {
    firstInputRef.current = null;
    lastInputRef.current = null;
    pastesRef.current = [];
  }, []);

  /** Live counters for the editor's status readout (cheap, O(1) reads). */
  const getPasteCount = useCallback(() => pastesRef.current.length, []);
  const getPastedChars = useCallback(() => pastesRef.current.reduce((a, p) => a + p.chars, 0), []);

  /** Build typed bursts from raw keydowns, then merge paste events on a time axis. */
  const buildTimeline = useCallback((raw: { key: string; eventType: string; timestamp: number }[]): TimelineEntry[] => {
    const typedKeys = raw.filter((e) => e.eventType === 'keydown' && (e.key.length === 1 || e.key === 'Enter'));
    const bursts: { type: 'type'; chars: number; t: number }[] = [];
    let curCount = 0, curStart = 0, lastT = 0;
    for (const e of typedKeys) {
      if (curCount === 0) { curStart = e.timestamp; curCount = 1; lastT = e.timestamp; continue; }
      if (e.timestamp - lastT > BURST_GAP_MS) { bursts.push({ type: 'type', chars: curCount, t: curStart }); curCount = 1; curStart = e.timestamp; }
      else curCount += 1;
      lastT = e.timestamp;
    }
    if (curCount > 0) bursts.push({ type: 'type', chars: curCount, t: curStart });
    const pasteEvents = pastesRef.current.map((p) => ({ type: 'paste' as const, chars: p.chars, origin: p.origin, t: p.t }));
    return [...bursts, ...pasteEvents].sort((a, b) => a.t - b.t);
  }, []);

  /** Finish the session and produce a full, publishable proof. */
  const finish = useCallback(async (content: string, title: string): Promise<ExtensionProof> => {
    stopCapture();
    const raw = getRawKeystrokeData();
    const keydowns = raw.filter((e) => e.eventType === 'keydown');
    const keystrokeCount = keydowns.length;
    const backspaceCount = keydowns.filter((e) => e.key === 'Backspace').length;

    const started = firstInputRef.current ?? Date.now();
    const ended = lastInputRef.current ?? started;
    const elapsedMs = Math.max(0, ended - started);
    const typingSpeed = elapsedMs > 0 ? (keystrokeCount / (elapsedMs / 1000)) : 0; // chars/sec

    const pastes = pastesRef.current;
    const pastedChars = pastes.reduce((a, p) => a + p.chars, 0);
    const externalPastedChars = pastes.filter((p) => p.origin === 'external').reduce((a, p) => a + p.chars, 0);
    const internalPastedChars = pastes.filter((p) => p.origin === 'internal_move').reduce((a, p) => a + p.chars, 0);
    const largestPaste = pastes.reduce((m, p) => Math.max(m, p.chars), 0);
    const largestExternalPaste = pastes.filter((p) => p.origin === 'external').reduce((m, p) => Math.max(m, p.chars), 0);
    const bigPastes = pastes.filter((p) => p.chars >= BIG_PASTE).length;

    const textLength = content.length;
    const typedChars = Math.max(0, textLength - pastedChars);
    const humanTypedRatio = textLength > 0 ? Math.max(0, Math.min(1, typedChars / textLength)) : 1;

    const minutes = elapsedMs / 60000;
    const wpm = minutes > 0.05 ? Math.round((typedChars / 5) / minutes) : 0;

    const timeline = buildTimeline(raw);
    const typedEdits = timeline.filter((e) => e.type === 'type').length;
    const pasteEdits = timeline.filter((e) => e.type === 'paste').length;

    const [contentHash, humanSignatureHash] = await Promise.all([
      hashContent(content),
      generateHumanSignatureHash(extractFeatures(raw)),
    ]);

    const proof: ExtensionProof = {
      v: 1,
      source: 'creator-editor',
      context: 'creator-editor',
      contentHash,
      humanSignatureHash,
      keystrokeCount,
      typingSpeed,
      text: content,
      docTitle: title.trim() || 'Untitled',
      metrics: {
        wpm,
        typingSpeedCharsPerSec: typingSpeed,
        keystrokeCount,
        backspaceCount,
        pasteCount: pastes.length,
        pastedChars,
        largestPaste,
        bigPastes,
        humanTypedRatio,
        pageExits: getTabAwayCount(),
        elapsedMs,
        textLength,
      },
      revision: {
        editCount: typedEdits + pasteEdits,
        typedEdits,
        pasteEdits,
        typedChars,
        pastedChars,
        externalPastedChars,
        internalPastedChars,
        citedPastedChars: 0,
        largestExternalPaste,
        humanTypedRatio,
        largestPaste,
        timeline,
      },
      docsRevision: null,
    };
    return proof;
  }, [stopCapture, getRawKeystrokeData, getTabAwayCount, buildTimeline, extractFeatures, generateHumanSignatureHash]);

  return { attach, noteInput, notePaste, finish, reset, isCapturing, getPasteCount, getPastedChars };
}
