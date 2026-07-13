import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { loadProof, PROOF_KEY, ExtensionProof } from '../lib/authorship';
import { useLiveWritingCapture } from '../hooks/useLiveWritingCapture';
import PublishProofPage from './PublishProofPage';

/**
 * /creator — the creator surface.
 *
 * Same report and on-chain publish as the student flow at /publish; the only
 * differences are the copy and the INPUT. Students write in Google Docs and hand
 * off via the Chrome extension. Creators write here, in an on-page editor that
 * tracks the writing the same way, then see the identical proof report (reused
 * verbatim from /publish, in creator wording).
 */
export default function CreatorProofPage() {
  // Start on the editor every time. Only a genuine URL-hash handoff (a future
  // creator extension) pre-loads a proof — we deliberately IGNORE any leftover
  // sessionStorage proof so a prior session can't skip the editor.
  const [proof, setProof] = useState<ExtensionProof | null>(() => {
    const hasHash = /proof=/.test(window.location.hash || '');
    return hasHash ? (loadProof().proof || null) : null;
  });

  // Clear any stale pending proof so nothing lingers to resurrect later.
  useEffect(() => {
    if (!proof) { try { sessionStorage.removeItem(PROOF_KEY); } catch { /* ignore */ } }
  }, [proof]);

  if (!proof) return <CreatorEditor onComplete={setProof} />;
  return <PublishProofPage variant="creator" injectedProof={proof} />;
}

/**
 * The tracked writing surface. Everything typed and pasted here is recorded in
 * the browser (keystroke biometrics, edits, pastes, time) and, on submit, turned
 * into the same proof the report and publish flow consume.
 */
function CreatorEditor({ onComplete }: { onComplete: (p: ExtensionProof) => void }) {
  const cap = useLiveWritingCapture();
  const taRef = useRef<HTMLTextAreaElement>(null);
  const attachedRef = useRef(false);
  const [title, setTitle] = useState('');
  const [text, setText] = useState('');
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [now, setNow] = useState(Date.now());
  const [building, setBuilding] = useState(false);

  // Attach keystroke capture EXACTLY once. (startCapture clears its buffer, so
  // re-running this on every render would wipe the tracking on each keystroke.)
  useEffect(() => {
    if (taRef.current && !attachedRef.current) { attachedRef.current = true; cap.attach(taRef.current); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (startedAt == null) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [startedAt]);

  const onChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    if (startedAt == null) setStartedAt(Date.now());
    cap.noteInput();
    setText(e.target.value);
  };
  const onPaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const pasted = e.clipboardData.getData('text');
    if (pasted) cap.notePaste(pasted, text);
  };

  const words = text.trim() ? text.trim().split(/\s+/).length : 0;
  const elapsedMs = startedAt ? now - startedAt : 0;
  const mins = Math.floor(elapsedMs / 60000);
  const secs = Math.floor((elapsedMs % 60000) / 1000);
  const wpm = elapsedMs > 3000 ? Math.round(words / (elapsedMs / 60000)) : 0;
  const pastes = cap.getPasteCount();
  const canSubmit = text.trim().length > 0 && !building;

  const submit = async () => {
    setBuilding(true);
    try { onComplete(await cap.finish(text, title)); }
    catch { setBuilding(false); }
  };

  return (
    <div style={styles.wrap}>
      <h1 style={styles.h1}>Write your piece</h1>
      <p style={styles.muted}>
        Draft here and Human Ink records the writing process — keystrokes, edits, pastes and time invested.
        When you finish, you get a proof of human writing you can publish on-chain and share with your audience.
      </p>

      <div style={styles.card}>
        <input
          style={styles.titleInput}
          placeholder="Title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          maxLength={200}
        />
        <textarea
          ref={taRef}
          style={styles.editor}
          placeholder="Start writing. Everything in this editor is recorded as proof of your effort."
          value={text}
          onChange={onChange}
          onPaste={onPaste}
          rows={16}
          spellCheck
        />
        <div style={styles.bar}>
          <span>{startedAt ? 'Recording' : 'Ready'} · {words} words · {wpm} WPM · {pastes} {pastes === 1 ? 'paste' : 'pastes'} · {mins}m {secs}s</span>
          <span style={styles.hint}>Pastes are allowed but recorded — write in your own words for the strongest proof.</span>
        </div>
      </div>

      <button style={{ ...styles.primary, opacity: canSubmit ? 1 : 0.6 }} disabled={!canSubmit} onClick={submit}>
        {building ? 'Building your proof…' : 'Generate proof of human writing'}
      </button>
      <Link to="/" style={{ ...styles.link, marginTop: 14, display: 'block' }}>← Back to Human Ink</Link>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  wrap: { maxWidth: 'min(760px, 94vw)', margin: '32px auto', padding: '0 20px', color: 'var(--hi-text, #0a0a0a)' },
  h1: { fontSize: 20, marginBottom: 6, fontWeight: 700 },
  muted: { fontSize: 13, color: 'var(--hi-text-muted, #64748b)', margin: '6px 0 16px', lineHeight: 1.55 },
  card: { border: '1px solid var(--hi-border, #e6e9ee)', borderRadius: 10, background: 'var(--hi-surface, #fff)', overflow: 'hidden' },
  titleInput: { width: '100%', boxSizing: 'border-box', padding: '14px 16px', border: 'none', borderBottom: '1px solid var(--hi-border, #e6e9ee)', background: 'transparent', color: 'inherit', fontSize: 18, fontWeight: 700, fontFamily: 'inherit', outline: 'none' },
  editor: { width: '100%', boxSizing: 'border-box', padding: '16px', border: 'none', background: 'transparent', color: 'inherit', fontSize: 15, lineHeight: 1.65, fontFamily: 'Georgia, "Times New Roman", serif', outline: 'none', resize: 'vertical', minHeight: 320 },
  bar: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap', padding: '10px 16px', borderTop: '1px solid var(--hi-border, #e6e9ee)', background: 'var(--hi-surface-muted, #f4f6f9)', fontSize: 12, color: 'var(--hi-text-muted, #64748b)' },
  hint: { fontSize: 11, opacity: 0.85 },
  primary: { width: '100%', maxWidth: 420, margin: '18px auto 0', display: 'block', padding: '11px 14px', borderRadius: 8, border: 'none', background: '#6ee7b7', color: '#0b0d10', fontWeight: 650, fontSize: 14, cursor: 'pointer' },
  link: { color: '#6ee7b7', fontSize: 13, textDecoration: 'none' },
};
