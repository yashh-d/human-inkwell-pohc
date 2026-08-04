import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import PublishProofPage from './PublishProofPage';
import {
  fetchSubmission,
  listAssignments,
  attachSubmission,
  type SubmissionView,
  type AssignmentRow,
} from '../submissionsApi';
import { getSession } from '../professorAuth';

/**
 * /s/:slug — the shareable report link.
 *
 *   • Anyone with the link sees the SUMMARY (process + AI score + band).
 *   • A signed-in PROFESSOR additionally gets the full detailed report (rendered
 *     by PublishProofPage in reportOnly mode) plus who submitted.
 *
 * We pass the professor's Supabase access token to the API; the server decides
 * what to return. Students never see the detail here — even for their own work.
 */
export default function SubmissionReportPage() {
  const { slug = '' } = useParams();
  const [view, setView] = useState<SubmissionView | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const session = await getSession();
        const data = await fetchSubmission(slug, session?.access_token);
        if (alive) setView(data);
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : 'Could not load this report.');
      }
    })();
    return () => {
      alive = false;
    };
  }, [slug]);

  if (error) {
    return (
      <div style={box}>
        <h1 style={h1}>Report unavailable</h1>
        <p style={muted}>{error}</p>
        <Link to="/" style={link}>← Home</Link>
      </div>
    );
  }
  if (!view) {
    return (
      <div style={box}>
        <p style={muted}>Loading report…</p>
      </div>
    );
  }

  // Professor: full detailed report from the stored proof.
  if (view.viewer === 'professor' && view.detail) {
    const who = view.student?.name || view.student?.email || 'this student';
    return (
      <div>
        <div style={profBar}>
          <div style={profBarInfo}>
            <span style={profBadge}>Professor view</span>
            <span style={profWho}>{who}</span>
            {view.assignment && <span style={profAsg}>{view.assignment.title}</span>}
          </div>
          <div style={profBarActions}>
            <CopyLinkButton slug={slug} />
            <AttachControl slug={slug} attached={view.assignment} />
            <Link to="/dashboard" style={dashLink}>Dashboard →</Link>
          </div>
        </div>
        <PublishProofPage injectedProof={view.detail} reportOnly />
      </div>
    );
  }

  // Public / student: summary only.
  return <SummaryOnly view={view} />;
}

/** Copies the shareable /s/:slug link for this student's report. */
function CopyLinkButton({ slug }: { slug: string }) {
  const [copied, setCopied] = useState(false);
  const url =
    typeof window !== 'undefined' ? window.location.href : `/s/${slug}`;
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      /* clipboard blocked — no-op */
    }
  };
  return (
    <button style={ghostSm} onClick={copy}>
      {copied ? 'Link copied' : 'Copy student link'}
    </button>
  );
}

/**
 * Lets the professor attach this submission to one of their assignments, if it
 * isn't already in one. Loads the professor's assignments with their token.
 */
function AttachControl({
  slug,
  attached,
}: {
  slug: string;
  attached: SubmissionView['assignment'];
}) {
  const [assignments, setAssignments] = useState<AssignmentRow[] | null>(null);
  const [choice, setChoice] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(attached?.title ?? null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (attached) return; // already in an assignment; nothing to load
    let alive = true;
    getSession().then((s) => {
      if (!s?.access_token) return;
      listAssignments(s.access_token)
        .then((a) => alive && setAssignments(a))
        .catch(() => alive && setAssignments([]));
    });
    return () => {
      alive = false;
    };
  }, [attached]);

  const attach = async () => {
    if (!choice) return;
    setBusy(true);
    setErr(null);
    try {
      const r = await attachSubmission({ slug, assignment_id: choice });
      setDone(r.assignment.title);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not attach.');
    } finally {
      setBusy(false);
    }
  };

  if (done) return <span style={attachedTag}>In: {done}</span>;
  if (!assignments || assignments.length === 0) return null;

  return (
    <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
      <select style={selectSm} value={choice} onChange={(e) => setChoice(e.target.value)}>
        <option value="">Add to assignment…</option>
        {assignments.map((a) => (
          <option key={a.id} value={a.id}>
            {a.title}
          </option>
        ))}
      </select>
      <button style={{ ...primarySm, opacity: choice && !busy ? 1 : 0.5 }} disabled={!choice || busy} onClick={attach}>
        {busy ? 'Adding…' : 'Add'}
      </button>
      {err && <span style={errSm}>{err}</span>}
    </span>
  );
}

function SummaryOnly({ view }: { view: SubmissionView }) {
  const s = view.summary;
  const bandColor =
    s.band === 'green' ? '#6ee7b7' : s.band === 'yellow' ? '#fbbf24' : s.band === 'red' ? '#f87171' : '#94a3b8';
  const bandLabel =
    s.band === 'green' ? 'Authentic, clear to move on' : s.band === 'yellow' ? 'Worth a glance' : s.band === 'red' ? 'Investigate' : '—';
  const aiColor =
    s.ai_score == null ? '#94a3b8' : s.ai_score < 30 ? '#6ee7b7' : s.ai_score <= 70 ? '#fbbf24' : '#f87171';

  return (
    <div style={box}>
      <h1 style={h1}>Human Ink report</h1>
      <p style={muted}>Proof of human writing · summary view</p>

      <div style={heroRow}>
        <div style={{ ...hero, borderColor: bandColor }}>
          <div style={heroLabel}>Process Score</div>
          <div style={{ ...heroNum, color: bandColor }}>{s.authorship_score ?? '—'}</div>
          <div style={{ ...pill, color: bandColor, borderColor: bandColor }}>{bandLabel}</div>
        </div>
        <div style={{ ...hero, borderColor: aiColor }}>
          <div style={heroLabel}>AI probability</div>
          <div style={{ ...heroNum, color: aiColor }}>{s.ai_score == null ? '—' : `${s.ai_score}%`}</div>
          <div style={{ ...pill, color: aiColor, borderColor: aiColor }}>post-hoc reference</div>
        </div>
      </div>

      <p style={{ ...muted, marginTop: 18 }}>
        The detailed breakdown (revision history, typing evidence, integrity checks) is available to the
        professor this was submitted to.
      </p>
      <Link to="/" style={link}>← Home</Link>
    </div>
  );
}

const box: React.CSSProperties = { maxWidth: 720, margin: '0 auto', padding: '48px 20px', color: '#e5e7eb' };
const h1: React.CSSProperties = { fontSize: 26, fontWeight: 800, marginBottom: 6 };
const muted: React.CSSProperties = { color: '#94a3b8', fontSize: 14, lineHeight: 1.6 };
const link: React.CSSProperties = { color: '#818cf8', fontSize: 14, display: 'inline-block', marginTop: 16 };
const heroRow: React.CSSProperties = { display: 'flex', gap: 14, marginTop: 22, flexWrap: 'wrap' };
const hero: React.CSSProperties = { flex: '1 1 220px', padding: 18, border: '1px solid #2a2f3a', borderRadius: 14, background: '#12151c' };
const heroLabel: React.CSSProperties = { fontSize: 13, color: '#cbd5e1', textTransform: 'uppercase', letterSpacing: 0.6 };
const heroNum: React.CSSProperties = { fontSize: 44, fontWeight: 800, margin: '6px 0' };
const pill: React.CSSProperties = { display: 'inline-block', fontSize: 12, padding: '3px 10px', borderRadius: 999, border: '1px solid' };
const INK = '#0b0d0e';
const CYAN_INK = '#075985';
const LINE = 'rgba(11, 13, 14, 0.10)';
const FONT = "'Space Grotesk', 'Inter', system-ui, sans-serif";

const profBar: React.CSSProperties = {
  display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap',
  maxWidth: 900, margin: '0 auto', padding: '12px 20px', fontSize: 13, color: INK,
  borderBottom: '1px solid ' + LINE, fontFamily: FONT,
};
const profBarInfo: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 10, minWidth: 0, flexWrap: 'wrap' };
const profBadge: React.CSSProperties = { fontSize: 10.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.6, color: CYAN_INK, border: '1px solid rgba(0,180,216,0.35)', background: 'rgba(0,180,216,0.08)', borderRadius: 999, padding: '3px 10px' };
const profWho: React.CSSProperties = { fontWeight: 700, color: INK, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' };
const profAsg: React.CSSProperties = { color: 'rgba(11,13,14,0.56)', fontSize: 12.5 };
const profBarActions: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' };
const ghostSm: React.CSSProperties = { padding: '8px 13px', borderRadius: 9, border: '1px solid ' + LINE, background: '#fff', color: INK, fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: FONT };
const primarySm: React.CSSProperties = { padding: '8px 14px', borderRadius: 9, border: '1px solid ' + INK, background: INK, color: '#fff', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: FONT, whiteSpace: 'nowrap' };
const selectSm: React.CSSProperties = { padding: '8px 10px', borderRadius: 9, border: '1px solid ' + LINE, background: '#fff', color: INK, fontSize: 13, fontFamily: FONT, cursor: 'pointer' };
const attachedTag: React.CSSProperties = { fontSize: 12.5, fontWeight: 600, color: CYAN_INK, background: 'rgba(0,180,216,0.08)', border: '1px solid rgba(0,180,216,0.28)', borderRadius: 999, padding: '5px 11px' };
const dashLink: React.CSSProperties = { color: CYAN_INK, fontSize: 13, fontWeight: 600, textDecoration: 'none', whiteSpace: 'nowrap' };
const errSm: React.CSSProperties = { color: '#dc2626', fontSize: 12 };
