import { useEffect, useRef, useState } from 'react';
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

type Onchain = {
  chain_id?: number;
  contract_address?: string;
  entry_id?: number;
  content_hash?: string;
  transaction_hash?: string;
};

/**
 * One card the student fills in BEFORE they publish: their name (required) and,
 * optionally, the professor's assignment to drop this into. Nothing is written
 * server-side yet — the name/target are just held locally.
 *
 * Once `published` flips true (the on-chain write confirmed), the card finalizes:
 * it stores the submission, gets the /s/<slug> link, and — if the student pre-picked
 * a target — attaches it to that assignment automatically. Then it shows the link to
 * copy plus the attachment status, with the picker still available as a fallback.
 *
 * The student never sees the detailed breakdown here; that's professor-only.
 */
export default function StudentSubmitPanel({
  proof,
  summary,
  onchain,
  published,
  onReadyChange,
}: {
  proof: ExtensionProof;
  summary: SubmissionSummary;
  onchain: Onchain;
  /** True once the on-chain publish has confirmed. */
  published: boolean;
  /** Reports whether the required fields (name) are filled, so the page can gate the publish button. */
  onReadyChange?: (ready: boolean) => void;
}) {
  // ---- Collected before publish ----
  const [name, setName] = useState<string>(() => rememberedStudentName());
  const [tree, setTree] = useState<DirectoryTree | null>(null);
  const [schoolId, setSchoolId] = useState('');
  const [profId, setProfId] = useState('');
  const [asgId, setAsgId] = useState('');
  const [code, setCode] = useState('');

  // ---- Finalization (after publish) ----
  const [slug, setSlug] = useState<string | null>(null);
  const [attachedTitle, setAttachedTitle] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveErr, setSaveErr] = useState<string | null>(null);
  const [attachErr, setAttachErr] = useState<string | null>(null);
  const [attachBusy, setAttachBusy] = useState(false);
  const finalized = useRef(false);

  useEffect(() => {
    fetchDirectory()
      .then(setTree)
      .catch(() => setTree({ schools: [] }));
  }, []);

  // Let the page know if the student can publish yet (name is required).
  useEffect(() => {
    onReadyChange?.(name.trim().length > 0);
  }, [name, onReadyChange]);

  const schools = tree?.schools || [];
  const profs = schools.find((sc) => String(sc.id) === schoolId)?.professors || [];
  const asgs = profs.find((p) => p.id === profId)?.assignments || [];

  const finalize = async () => {
    const fullName = name.trim();
    if (!fullName) return;
    setSaving(true);
    setSaveErr(null);
    setAttachErr(null);
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
      // If they pre-picked a target, attach it now. A failure here is non-fatal —
      // they still have a valid link and can retry with the picker below.
      const target = asgId
        ? { assignment_id: asgId }
        : code.trim()
        ? { join_code: code.trim() }
        : null;
      if (target) {
        try {
          const a = await attachSubmission({ slug: r.share_slug, ...target });
          setAttachedTitle(a.assignment.title);
        } catch (e) {
          setAttachErr(e instanceof Error ? e.message : 'Could not add it to that assignment.');
        }
      }
    } catch (e) {
      setSaveErr(e instanceof Error ? e.message : 'Could not save your submission.');
    } finally {
      setSaving(false);
    }
  };

  // Finalize once, the moment the on-chain publish confirms.
  useEffect(() => {
    if (published && !finalized.current && name.trim()) {
      finalized.current = true;
      finalize();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [published]);

  const link = slug ? `${window.location.origin}/s/${slug}` : '';

  const doAttach = async (payload: { assignment_id?: string; join_code?: string }) => {
    if (!slug) return;
    setAttachBusy(true);
    setAttachErr(null);
    try {
      const a = await attachSubmission({ slug, ...payload });
      setAttachedTitle(a.assignment.title);
    } catch (e) {
      setAttachErr(e instanceof Error ? e.message : 'Could not add it to that assignment.');
    } finally {
      setAttachBusy(false);
    }
  };

  const selects = (
    <div style={s.selects}>
      <select
        style={s.select}
        value={schoolId}
        onChange={(e) => { setSchoolId(e.target.value); setProfId(''); setAsgId(''); }}
      >
        <option value="">School…</option>
        {schools.map((sc) => (
          <option key={String(sc.id)} value={String(sc.id)}>{sc.name}</option>
        ))}
      </select>
      <select
        style={s.select}
        value={profId}
        disabled={!schoolId}
        onChange={(e) => { setProfId(e.target.value); setAsgId(''); }}
      >
        <option value="">Professor…</option>
        {profs.map((p) => (
          <option key={p.id} value={p.id}>{p.name}</option>
        ))}
      </select>
      <select
        style={s.select}
        value={asgId}
        disabled={!profId}
        onChange={(e) => setAsgId(e.target.value)}
      >
        <option value="">Assignment…</option>
        {asgs.map((a) => (
          <option key={a.id} value={a.id}>{a.title}</option>
        ))}
      </select>
    </div>
  );

  // ── Post-publish: show the share link + attachment status ─────────────────
  if (published) {
    return (
      <div style={s.panel}>
        <div style={s.h}>Share with your professor</div>
        {name.trim() && <p style={s.intro}>Submitting as <strong>{name.trim()}</strong>.</p>}

        {saving && <p style={s.saving}>Finalizing your share link…</p>}

        {saveErr && (
          <>
            <p style={s.err}>{saveErr}</p>
            <p style={s.hint}>Your proof is still on-chain — you can try saving again.</p>
            <button
              style={{ ...s.primary, marginTop: 10, opacity: saving ? 0.5 : 1 }}
              disabled={saving}
              onClick={() => { finalize(); }}
            >
              {saving ? 'Saving…' : 'Try again'}
            </button>
          </>
        )}

        {slug && (
          <>
            <CopyRow value={link} />
            <p style={s.hint}>
              No assignment? Just copy this link and paste it anywhere — at the bottom of your doc, in
              an email, wherever. Your professor opens it to see the full report.
            </p>

            {attachedTitle ? (
              <div style={s.ok}>
                Added to <strong>{attachedTitle}</strong>. Your professor will see it in that assignment.
              </div>
            ) : (
              <div style={s.attach}>
                <div style={s.label}>Add to an assignment</div>
                {selects}
                <button
                  style={{ ...s.primary, opacity: asgId && !attachBusy ? 1 : 0.5 }}
                  disabled={!asgId || attachBusy}
                  onClick={() => doAttach({ assignment_id: asgId })}
                >
                  Add to assignment
                </button>

                <div style={s.or}>or enter a join code</div>
                <div style={s.copyRow}>
                  <input
                    style={s.codeInput}
                    placeholder="e.g. 7KQ2M9"
                    value={code}
                    onChange={(e) => setCode(e.target.value.toUpperCase())}
                  />
                  <button
                    style={{ ...s.copyBtn, opacity: code.trim() && !attachBusy ? 1 : 0.5 }}
                    disabled={!code.trim() || attachBusy}
                    onClick={() => doAttach({ join_code: code.trim() })}
                  >
                    Add by code
                  </button>
                </div>
                {attachErr && <p style={s.err}>{attachErr}</p>}
              </div>
            )}
          </>
        )}
      </div>
    );
  }

  // ── Pre-publish: collect name + (optional) assignment target ──────────────
  return (
    <div style={s.panel}>
      <div style={s.h}>Prepare your submission</div>
      <p style={s.intro}>
        Fill this in now. When you publish below, we’ll generate your share link — and drop it
        straight into your professor’s assignment if you pick one.
      </p>

      <div style={s.label}>Your name</div>
      <input
        style={s.nameInput}
        value={name}
        maxLength={80}
        autoFocus
        placeholder="Your full name"
        onChange={(e) => setName(e.target.value)}
      />
      <p style={s.hint}>
        Enter your full name so your professor can identify your work — they’ll see this on the
        report, not just your email.
      </p>
      {proof.email && <p style={s.hint}>Signed in as {proof.email}</p>}

      <div style={s.divider} />

      <div style={s.label}>Send to an assignment <span style={s.optional}>(optional)</span></div>
      {selects}
      <div style={s.or}>or enter a join code</div>
      <input
        style={{ ...s.codeInput, width: '100%', boxSizing: 'border-box' }}
        placeholder="e.g. 7KQ2M9"
        value={code}
        onChange={(e) => setCode(e.target.value.toUpperCase())}
      />
      <p style={s.hint}>
        No assignment yet? Skip this — you can copy a share link after publishing instead.
      </p>
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

const s: Record<string, React.CSSProperties> = {
  panel: {
    marginTop: 18,
    padding: 20,
    border: '1px solid var(--hi-border)',
    borderRadius: 'var(--hi-r-md)',
    background: 'var(--hi-surface)',
    boxShadow: 'var(--hi-shadow)',
  },
  h: { fontWeight: 700, fontSize: 16, marginBottom: 6, color: 'var(--hi-text)', letterSpacing: '-0.01em' },
  intro: { fontSize: 13, color: 'var(--hi-text-muted)', margin: '0 0 16px', lineHeight: 1.55 },
  label: {
    fontSize: 11,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    fontWeight: 700,
    color: 'var(--hi-text-muted)',
    marginBottom: 8,
  },
  optional: { textTransform: 'none', letterSpacing: 0, fontWeight: 500, color: 'var(--hi-text-faint)' },
  hint: { fontSize: 12.5, color: 'var(--hi-text-muted)', marginTop: 8, lineHeight: 1.5 },
  saving: { fontSize: 13.5, color: 'var(--hi-text-muted)', marginTop: 6 },
  divider: { height: 1, background: 'var(--hi-border)', margin: '20px 0' },
  copyRow: { display: 'flex', gap: 8, alignItems: 'center' },
  linkInput: {
    flex: 1,
    minWidth: 0,
    padding: '10px 12px',
    borderRadius: 'var(--hi-r-sm)',
    border: '1px solid var(--hi-border-bright)',
    background: 'var(--hi-surface-muted)',
    color: 'var(--hi-text)',
    fontSize: 13,
    fontFamily: 'var(--hi-font-mono)',
  },
  codeInput: {
    flex: 1,
    minWidth: 0,
    padding: '10px 12px',
    borderRadius: 'var(--hi-r-sm)',
    border: '1px solid var(--hi-border-bright)',
    background: 'var(--hi-surface)',
    color: 'var(--hi-text)',
    fontSize: 13,
    fontFamily: 'var(--hi-font-mono)',
  },
  nameInput: {
    boxSizing: 'border-box',
    width: '100%',
    padding: '11px 12px',
    borderRadius: 'var(--hi-r-sm)',
    border: '1px solid var(--hi-border-bright)',
    background: 'var(--hi-surface)',
    color: 'var(--hi-text)',
    fontSize: 14,
    fontFamily: 'inherit',
  },
  copyBtn: {
    padding: '10px 16px',
    borderRadius: 'var(--hi-r-sm)',
    border: '1px solid var(--hi-border-bright)',
    background: 'var(--hi-surface)',
    color: 'var(--hi-cyan-ink)',
    fontSize: 13,
    fontWeight: 700,
    cursor: 'pointer',
    whiteSpace: 'nowrap',
    fontFamily: 'inherit',
  },
  attach: { marginTop: 16, paddingTop: 16, borderTop: '1px solid var(--hi-border)' },
  selects: { display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10 },
  select: {
    flex: '1 1 140px',
    padding: '10px 11px',
    borderRadius: 'var(--hi-r-sm)',
    border: '1px solid var(--hi-border-bright)',
    background: 'var(--hi-surface)',
    color: 'var(--hi-text)',
    fontSize: 13,
    fontFamily: 'inherit',
  },
  primary: {
    padding: '10px 16px',
    borderRadius: 'var(--hi-r-sm)',
    border: 'none',
    background: '#4f46e5',
    color: '#fff',
    fontSize: 14,
    fontWeight: 700,
    cursor: 'pointer',
    fontFamily: 'inherit',
  },
  or: { fontSize: 12, color: 'var(--hi-text-faint)', textAlign: 'center', margin: '14px 0 10px' },
  ok: {
    marginTop: 14,
    padding: '12px 14px',
    borderRadius: 'var(--hi-r-sm)',
    border: '1px solid var(--hi-success-border)',
    background: 'var(--hi-success-surface)',
    color: 'var(--hi-success-ink)',
    fontSize: 13.5,
    lineHeight: 1.45,
  },
  err: { color: 'var(--hi-danger)', fontSize: 13, marginTop: 8 },
};
