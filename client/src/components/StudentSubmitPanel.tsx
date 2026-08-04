import { useEffect, useMemo, useRef, useState } from 'react';
import type { ExtensionProof } from '../lib/authorship';
import {
  createSubmission,
  fetchDirectory,
  attachSubmission,
  type SubmissionSummary,
  type DirectoryTree,
} from '../submissionsApi';

const STUDENT_NAME_KEY = 'humanink_student_name';
/** Remember the student's name so repeat submitters don't retype it. */
function rememberedStudentName(): string {
  try {
    return localStorage.getItem(STUDENT_NAME_KEY) || '';
  } catch {
    return '';
  }
}
function rememberStudentName(name: string): void {
  try {
    localStorage.setItem(STUDENT_NAME_KEY, name);
  } catch {
    /* storage blocked — non-fatal */
  }
}

/**
 * Shown to a student right after a successful on-chain publish. It:
 *   1. Stores the submission server-side (summary + professor-only detail) and
 *      gets back the /s/<slug> link.
 *   2. Lets them copy that link (paste-anywhere fallback), OR
 *   3. Attach it to a professor's assignment — by browsing school → professor →
 *      assignment, or by typing an assignment join code.
 *
 * The student never sees the detailed breakdown here; that's professor-only.
 */
export default function StudentSubmitPanel({
  proof,
  summary,
  onchain,
}: {
  proof: ExtensionProof;
  summary: SubmissionSummary;
  onchain: {
    chain_id?: number;
    contract_address?: string;
    entry_id?: number;
    content_hash?: string;
    transaction_hash?: string;
  };
}) {
  const [slug, setSlug] = useState<string | null>(null);
  const [createErr, setCreateErr] = useState<string | null>(null);
  const [name, setName] = useState<string>(() => rememberedStudentName());
  const [saving, setSaving] = useState(false);
  const posted = useRef(false);

  const save = async () => {
    const fullName = name.trim();
    if (!fullName || posted.current) return;
    posted.current = true;
    setSaving(true);
    setCreateErr(null);
    try {
      const r = await createSubmission({
        proof,
        summary,
        student_name: fullName,
        student_email: proof.email || null,
        chain_id: onchain.chain_id,
        contract_address: onchain.contract_address,
        entry_id: onchain.entry_id,
        content_hash: onchain.content_hash || proof.contentHash,
        transaction_hash: onchain.transaction_hash,
      });
      rememberStudentName(fullName);
      setSlug(r.share_slug);
    } catch (e) {
      posted.current = false; // let them retry
      setCreateErr(e instanceof Error ? e.message : 'Could not save your submission.');
    } finally {
      setSaving(false);
    }
  };

  const link = useMemo(
    () => (slug ? `${window.location.origin}/s/${slug}` : ''),
    [slug],
  );

  // Step 1 — name entry. We save only once the student names themselves, so the
  // professor sees a real name on the report and roster, not just an email.
  if (!slug) {
    return (
      <div style={s.panel}>
        <div style={s.h}>Add your name</div>
        <p style={s.hint}>
          Enter your full name so your professor can identify your work — they’ll see this on
          the report, not just your email.
        </p>
        <input
          style={s.nameInput}
          value={name}
          maxLength={80}
          autoFocus
          placeholder="Your full name"
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') save(); }}
        />
        {proof.email && <p style={s.hint}>Signed in as {proof.email}</p>}
        <button
          style={{ ...s.primary, marginTop: 12, opacity: name.trim() && !saving ? 1 : 0.5 }}
          disabled={!name.trim() || saving}
          onClick={save}
        >
          {saving ? 'Saving…' : 'Save & get share link'}
        </button>
        {createErr && (
          <>
            <p style={s.err}>{createErr}</p>
            <p style={s.hint}>Your proof is still on-chain — you can try saving again.</p>
          </>
        )}
      </div>
    );
  }

  return (
    <div style={s.panel}>
      <div style={s.h}>Share with your professor</div>
      {name.trim() && <p style={s.hint}>Submitting as <strong>{name.trim()}</strong>.</p>}
      <CopyRow value={link} />
      <p style={s.hint}>
        No assignment yet? Just copy this link and paste it anywhere — at the bottom of your doc, in an
        email, wherever. Your professor opens it to see the full report.
      </p>
      <AttachSection slug={slug} />
    </div>
  );
}

function CopyRow({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    try {
      navigator.clipboard.writeText(value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
    } catch {
      /* no clipboard */
    }
  };
  return (
    <div style={s.copyRow}>
      <input readOnly value={value} style={s.linkInput} onFocus={(e) => e.currentTarget.select()} />
      <button style={s.copyBtn} onClick={copy}>
        {copied ? 'Copied ✓' : 'Copy link'}
      </button>
    </div>
  );
}

function AttachSection({ slug }: { slug: string }) {
  const [tree, setTree] = useState<DirectoryTree | null>(null);
  const [schoolId, setSchoolId] = useState('');
  const [profId, setProfId] = useState('');
  const [asgId, setAsgId] = useState('');
  const [code, setCode] = useState('');
  const [attached, setAttached] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetchDirectory()
      .then(setTree)
      .catch(() => setTree({ schools: [] }));
  }, []);

  const schools = tree?.schools || [];
  const profs = schools.find((s) => String(s.id) === schoolId)?.professors || [];
  const asgs = profs.find((p) => p.id === profId)?.assignments || [];

  const doAttach = async (payload: { assignment_id?: string; join_code?: string }) => {
    setBusy(true);
    setErr(null);
    try {
      const r = await attachSubmission({ slug, ...payload });
      setAttached(r.assignment.title);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not attach.');
    } finally {
      setBusy(false);
    }
  };

  if (attached) {
    return <div style={s.ok}>Added to <strong>{attached}</strong>. Your professor will see it in that assignment.</div>;
  }

  return (
    <div style={s.attach}>
      <div style={s.sub}>Add to an assignment</div>

      <div style={s.selects}>
        <select style={s.select} value={schoolId} onChange={(e) => { setSchoolId(e.target.value); setProfId(''); setAsgId(''); }}>
          <option value="">School…</option>
          {schools.map((sc) => (
            <option key={String(sc.id)} value={String(sc.id)}>{sc.name}</option>
          ))}
        </select>
        <select style={s.select} value={profId} disabled={!schoolId} onChange={(e) => { setProfId(e.target.value); setAsgId(''); }}>
          <option value="">Professor…</option>
          {profs.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
        <select style={s.select} value={asgId} disabled={!profId} onChange={(e) => setAsgId(e.target.value)}>
          <option value="">Assignment…</option>
          {asgs.map((a) => (
            <option key={a.id} value={a.id}>{a.title}</option>
          ))}
        </select>
      </div>
      <button
        style={{ ...s.primary, opacity: asgId && !busy ? 1 : 0.5 }}
        disabled={!asgId || busy}
        onClick={() => doAttach({ assignment_id: asgId })}
      >
        Add to assignment
      </button>

      <div style={s.or}>or enter a join code</div>
      <div style={s.copyRow}>
        <input
          style={s.linkInput}
          placeholder="e.g. 7KQ2M9"
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
        />
        <button
          style={{ ...s.copyBtn, opacity: code.trim() && !busy ? 1 : 0.5 }}
          disabled={!code.trim() || busy}
          onClick={() => doAttach({ join_code: code.trim() })}
        >
          Add by code
        </button>
      </div>

      {err && <p style={s.err}>{err}</p>}
    </div>
  );
}

const s: Record<string, React.CSSProperties> = {
  panel: { marginTop: 18, padding: 16, border: '1px solid #2a2f3a', borderRadius: 12, background: '#12151c' },
  h: { fontWeight: 700, fontSize: 15, marginBottom: 10, color: '#e5e7eb' },
  sub: { fontWeight: 600, fontSize: 13, margin: '4px 0 8px', color: '#cbd5e1' },
  hint: { fontSize: 12.5, color: '#94a3b8', marginTop: 8, lineHeight: 1.5 },
  copyRow: { display: 'flex', gap: 8, alignItems: 'center' },
  linkInput: { flex: 1, minWidth: 0, padding: '9px 11px', borderRadius: 8, border: '1px solid #2a2f3a', background: '#0b0e14', color: '#e5e7eb', fontSize: 13, fontFamily: 'ui-monospace, Menlo, monospace' },
  nameInput: { boxSizing: 'border-box', width: '100%', padding: '11px 12px', borderRadius: 8, border: '1px solid #2a2f3a', background: '#0b0e14', color: '#e5e7eb', fontSize: 14, marginTop: 10 },
  copyBtn: { padding: '9px 14px', borderRadius: 8, border: '1px solid #3b4252', background: '#1c2230', color: '#e5e7eb', fontSize: 13, cursor: 'pointer', whiteSpace: 'nowrap' },
  attach: { marginTop: 16, paddingTop: 14, borderTop: '1px solid #22262f' },
  selects: { display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10 },
  select: { flex: '1 1 140px', padding: '9px 10px', borderRadius: 8, border: '1px solid #2a2f3a', background: '#0b0e14', color: '#e5e7eb', fontSize: 13 },
  primary: { padding: '10px 16px', borderRadius: 8, border: 'none', background: '#4f46e5', color: '#fff', fontSize: 14, fontWeight: 600, cursor: 'pointer' },
  or: { fontSize: 12, color: '#6b7280', textAlign: 'center', margin: '14px 0 8px' },
  ok: { marginTop: 14, padding: 12, borderRadius: 10, border: '1px solid #14532d', background: '#0e1f16', color: '#6ee7b7', fontSize: 13.5 },
  err: { color: '#f87171', fontSize: 13, marginTop: 8 },
};
