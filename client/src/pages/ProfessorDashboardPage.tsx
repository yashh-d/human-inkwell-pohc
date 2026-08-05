import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  professorAuthConfigured,
  getSession,
  onAuthChange,
  signInWithUsername,
  signInWithGoogle,
  updatePassword,
  linkGoogle,
  signOut,
} from '../professorAuth';
import {
  getMe,
  listAssignments,
  createAssignment,
  fetchRoster,
  updateAccount,
  type ProfessorProfile,
  type AssignmentRow,
  type RosterSubmission,
} from '../submissionsApi';

/**
 * /dashboard — the professor / education surface. This is a SEPARATE login from
 * the creator flow (no Privy, no wallet, no public @handle). Professors are
 * provisioned with a username + password they own and can change; identity is
 * the account, never the email. They see their assignments and, per assignment,
 * a roster of students with Human Ink scores. Clicking a student opens the full
 * gated report at /s/<slug>.
 */
type Phase = 'loading' | 'login' | 'not-professor' | 'ready';

export default function ProfessorDashboardPage() {
  const [token, setToken] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>('loading');
  const [profile, setProfile] = useState<ProfessorProfile | null>(null);

  // Track the Supabase session.
  useEffect(() => {
    if (!professorAuthConfigured()) {
      setPhase('login');
      return;
    }
    getSession().then((s) => setToken(s?.access_token ?? null));
    const off = onAuthChange((s) => setToken(s?.access_token ?? null));
    return off;
  }, []);

  // Resolve the professor profile whenever the token changes.
  useEffect(() => {
    let alive = true;
    if (token === null) {
      // Only downgrade to the login screen once we've finished the initial check.
      setPhase((p) => (p === 'loading' ? 'loading' : 'login'));
      // getSession has resolved by now in practice; ensure we don't hang.
      getSession().then((s) => {
        if (alive && !s) setPhase('login');
      });
      return;
    }
    setPhase('loading');
    getMe(token)
      .then((r) => {
        if (!alive) return;
        setProfile(r.profile);
        setPhase('ready');
      })
      .catch(() => {
        if (alive) setPhase('not-professor');
      });
    return () => {
      alive = false;
    };
  }, [token]);

  if (phase === 'loading') return <Shell><p style={muted}>Loading…</p></Shell>;

  if (phase === 'login') return <LoginView />;

  if (phase === 'not-professor') {
    return (
      <Shell>
        <h1 style={h1}>Not a professor account</h1>
        <p style={muted}>
          This account isn't set up for the professor dashboard. Ask your Human Ink admin to provision it, then sign in again.
        </p>
        <button style={ghost} onClick={() => signOut()}>Sign out</button>
      </Shell>
    );
  }

  return <Dashboard token={token!} profile={profile!} />;
}

function LoginView() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const configured = professorAuthConfigured();

  const canSubmit = username.trim() && password && !busy;

  const login = async () => {
    if (!canSubmit) return;
    setErr(null);
    setBusy(true);
    const r = await signInWithUsername(username, password);
    if (r.error) {
      setErr(r.error);
      setBusy(false);
    }
    // On success the auth listener flips the phase; no need to reset busy.
  };

  const google = async () => {
    setErr(null);
    const r = await signInWithGoogle();
    if (r.error) setErr(r.error);
  };

  return (
    <Shell>
      <div style={eduBadge}>Educator access</div>
      <h1 style={h1}>Professor sign in</h1>
      {!configured ? (
        <p style={muted}>Professor sign-in isn't configured yet (missing Supabase Auth settings).</p>
      ) : (
        <>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 14 }}>
            <input
              style={input}
              placeholder="Username"
              autoCapitalize="none"
              autoCorrect="off"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') login(); }}
            />
            <input
              style={input}
              type="password"
              placeholder="Password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') login(); }}
            />
            <button style={{ ...primary, opacity: canSubmit ? 1 : 0.5 }} disabled={!canSubmit} onClick={login}>
              {busy ? 'Signing in…' : 'Sign in'}
            </button>
          </div>
          <div style={{ ...muted, textAlign: 'center', margin: '16px 0 8px' }}>or, if you've linked it</div>
          <button style={ghostWide} onClick={google}>Continue with Google</button>
          {err && <p style={errText}>{err}</p>}
        </>
      )}
    </Shell>
  );
}

function Dashboard({ token, profile: initialProfile }: { token: string; profile: ProfessorProfile }) {
  const [profile, setProfile] = useState<ProfessorProfile>(initialProfile);
  const [assignments, setAssignments] = useState<AssignmentRow[] | null>(null);
  const [title, setTitle] = useState('');
  const [creating, setCreating] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [showAccount, setShowAccount] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(() => {
    listAssignments(token)
      .then(setAssignments)
      .catch((e) => setErr(e instanceof Error ? e.message : 'Could not load assignments.'));
  }, [token]);

  useEffect(() => { load(); }, [load]);

  const create = async () => {
    if (!title.trim()) return;
    setCreating(true);
    setErr(null);
    try {
      await createAssignment(token, title.trim());
      setTitle('');
      load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not create assignment.');
    } finally {
      setCreating(false);
    }
  };

  return (
    <Shell wide>
      <div style={topBar}>
        <div>
          <div style={eyebrowCyan}><span style={eyebrowTick} />Educator workspace</div>
          <h1 style={h1}>Assignments</h1>
          <p style={muted}>
            {profile.name || profile.username || 'Professor'}
            {profile.username ? (
              <>
                {' · '}
                <span style={{ color: CYAN_INK, fontWeight: 600 }}>@{profile.username}</span>
              </>
            ) : ''}
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button style={ghost} onClick={() => setShowAccount((v) => !v)}>Account</button>
          <button style={ghost} onClick={() => signOut()}>Sign out</button>
        </div>
      </div>

      {showAccount && (
        <AccountPanel token={token} profile={profile} onSaved={setProfile} />
      )}

      <div style={createRow}>
        <input
          style={input}
          placeholder="New assignment title (e.g. Essay 1 — The Odyssey)"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') create(); }}
        />
        <button style={{ ...primaryAuto, opacity: title.trim() && !creating ? 1 : 0.5 }} disabled={!title.trim() || creating} onClick={create}>
          {creating ? 'Creating…' : 'Create'}
        </button>
      </div>
      {err && <p style={errText}>{err}</p>}

      {assignments === null ? (
        <p style={muted}>Loading…</p>
      ) : assignments.length === 0 ? (
        <p style={muted}>No assignments yet. Create one above, then share its join code (or let students browse to it).</p>
      ) : (
        <div style={{ marginTop: 16 }}>
          {assignments.map((a) => (
            <AssignmentCard
              key={a.id}
              a={a}
              token={token}
              open={openId === a.id}
              onToggle={() => setOpenId((cur) => (cur === a.id ? null : a.id))}
            />
          ))}
        </div>
      )}
    </Shell>
  );
}

function AccountPanel({
  token,
  profile,
  onSaved,
}: {
  token: string;
  profile: ProfessorProfile;
  onSaved: (p: ProfessorProfile) => void;
}) {
  const [name, setName] = useState(profile.name || '');
  const [email, setEmail] = useState(profile.linked_email || '');
  const [pw, setPw] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const saveDetails = async () => {
    setBusy(true);
    setErr(null);
    setMsg(null);
    try {
      const r = await updateAccount(token, { name: name.trim(), linked_email: email.trim() || null });
      onSaved(r.profile);
      setMsg('Saved.');
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not save.');
    } finally {
      setBusy(false);
    }
  };

  const changePw = async () => {
    setBusy(true);
    setErr(null);
    setMsg(null);
    const r = await updatePassword(pw);
    setBusy(false);
    if (r.error) setErr(r.error);
    else {
      setPw('');
      setMsg('Password updated.');
    }
  };

  const link = async () => {
    setErr(null);
    setMsg(null);
    const r = await linkGoogle();
    if (r.error) setErr(r.error);
  };

  return (
    <div style={{ ...cardTinted, padding: 18, marginTop: 16 }}>
      <div style={{ fontWeight: 700, fontSize: 16 }}>Your account</div>
      <p style={{ ...muted, marginTop: 4 }}>
        Username <strong style={{ color: CYAN_INK }}>@{profile.username}</strong> — this is your login and never changes here.
        Everything below is yours to edit.
      </p>

      <Section label="Profile" accent={CYAN} labelColor={CYAN_INK} tint="rgba(0, 180, 216, 0.05)">
        <label style={fieldLabel}>Display name</label>
        <input style={input} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Professor Rivers" />

        <label style={fieldLabel}>Email (optional — for records &amp; easy login later)</label>
        <input style={input} type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@school.edu" />

        <button style={{ ...primary, marginTop: 12, opacity: busy ? 0.6 : 1 }} disabled={busy} onClick={saveDetails}>
          Save details
        </button>
      </Section>

      <Section label="Security" accent="#7c6cff" labelColor={VIOLET_INK} tint="rgba(124, 108, 255, 0.06)">
        <label style={fieldLabel}>Change password</label>
        <div style={row}>
          <input style={input} type="password" value={pw} onChange={(e) => setPw(e.target.value)} placeholder="New password (min 8 chars)" />
          <button style={{ ...primaryAuto, opacity: pw.length >= 8 && !busy ? 1 : 0.5 }} disabled={pw.length < 8 || busy} onClick={changePw}>
            Update
          </button>
        </div>
      </Section>

      <Section label="Easy login" accent="#10b981" labelColor={MINT_INK} tint="rgba(16, 185, 129, 0.06)">
        <p style={muted}>Link your Google account so you can sign in with one click next time.</p>
        <button style={{ ...ghostWide, marginTop: 10 }} onClick={link}>Link Google</button>
      </Section>

      {msg && <p style={{ ...muted, color: MINT_INK, marginTop: 12, fontWeight: 600 }}>{msg}</p>}
      {err && <p style={errText}>{err}</p>}
    </div>
  );
}

function Section({
  label,
  accent,
  labelColor,
  tint,
  children,
}: {
  label: string;
  accent: string;
  labelColor: string;
  tint: string;
  children: React.ReactNode;
}) {
  return (
    <div style={{ marginTop: 14, padding: '13px 15px 15px', borderRadius: 12, background: tint, border: '1px solid ' + LINE_SOFT, borderLeft: '3px solid ' + accent }}>
      <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.7, textTransform: 'uppercase', color: labelColor }}>{label}</div>
      {children}
    </div>
  );
}

function AssignmentCard({
  a,
  token,
  open,
  onToggle,
}: {
  a: AssignmentRow;
  token: string;
  open: boolean;
  onToggle: () => void;
}) {
  const [roster, setRoster] = useState<RosterSubmission[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!open || roster) return;
    fetchRoster(token, a.id)
      .then((r) => setRoster(r.submissions))
      .catch((e) => setErr(e instanceof Error ? e.message : 'Could not load roster.'));
  }, [open, roster, token, a.id]);

  return (
    <div style={{ ...card, borderLeft: '3px solid rgba(0, 180, 216, 0.5)' }}>
      <button style={cardHead} onClick={onToggle}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 9, minWidth: 0 }}>
          <span style={{ width: 8, height: 8, borderRadius: 999, flex: '0 0 auto', background: a.submission_count > 0 ? CYAN : 'rgba(11, 13, 14, 0.16)' }} />
          <span style={{ fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.title}</span>
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 10, flex: '0 0 auto' }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: a.submission_count > 0 ? CYAN_INK : FAINT }}>
            {a.submission_count} submission{a.submission_count === 1 ? '' : 's'}
          </span>
          <span style={codePill}>{a.join_code}</span>
          <span style={{ color: FAINT }}>{open ? '▲' : '▼'}</span>
        </span>
      </button>

      {open && (
        <div style={{ padding: '4px 14px 14px' }}>
          {err && <p style={errText}>{err}</p>}
          {roster === null ? (
            <p style={muted}>Loading roster…</p>
          ) : roster.length === 0 ? (
            <p style={muted}>No submissions yet. Students attach by picking this assignment or entering code <span style={codePill}>{a.join_code}</span>.</p>
          ) : (
            <table style={table}>
              <thead>
                <tr>
                  <th style={th}>Student</th>
                  <th style={thc}>Process</th>
                  <th style={thc}>AI</th>
                  <th style={thc}>Integrity</th>
                  <th style={thr}>Submitted</th>
                </tr>
              </thead>
              <tbody>
                {roster.map((r) => (
                  <tr key={r.share_slug}>
                    <td style={td}>
                      <Link to={`/s/${r.share_slug}`} style={studentLink}>
                        {r.student_name || r.student_email || 'Unknown'}
                      </Link>
                    </td>
                    <td style={tdc}><ScorePill v={r.authorship_score} band={r.band} /></td>
                    <td style={tdc}><AiPill v={r.ai_score} /></td>
                    <td style={tdc}>{r.integrity_score ?? '—'}</td>
                    <td style={tdr}>{new Date(r.published_at).toLocaleDateString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}

function ScorePill({ v, band }: { v: number | null; band: RosterSubmission['band'] }) {
  const color = band === 'green' ? '#059669' : band === 'yellow' ? '#d97706' : band === 'red' ? '#dc2626' : FAINT;
  return <span style={{ ...scorePill, color, borderColor: color }}>{v ?? '—'}</span>;
}
function AiPill({ v }: { v: number | null }) {
  const color = v == null ? FAINT : v < 30 ? '#059669' : v <= 70 ? '#d97706' : '#dc2626';
  return <span style={{ ...scorePill, color, borderColor: color }}>{v == null ? '—' : `${v}%`}</span>;
}

function Shell({ children, wide }: { children: React.ReactNode; wide?: boolean }) {
  return (
    <div style={page}>
      <div style={{ maxWidth: wide ? 920 : 440, margin: '0 auto', padding: '56px 22px 72px' }}>
        {children}
        <Link to="/" style={homeLink}>← Home</Link>
      </div>
    </div>
  );
}

// Match the product's landing/education design system: light canvas, ink-black
// text, cyan reserved as a sparing accent, hairline borders, white cards.
const FONT = "'Space Grotesk', 'Inter', system-ui, sans-serif";
const INK = '#0b0d0e';
const MUTED = 'rgba(11, 13, 14, 0.56)';
const FAINT = 'rgba(11, 13, 14, 0.40)';
const LINE = 'rgba(11, 13, 14, 0.10)';
const LINE_SOFT = 'rgba(11, 13, 14, 0.07)';
const CYAN = '#00b4d8';
const CYAN_INK = '#075985';
const VIOLET_INK = '#4b3fb0';
const MINT_INK = '#047857';

const page: React.CSSProperties = {
  minHeight: '100vh',
  background: 'radial-gradient(120% 70% at 88% -8%, rgba(0, 180, 216, 0.07), transparent 60%), #fbfcfd',
  color: INK,
  fontFamily: FONT,
};
const h1: React.CSSProperties = { fontSize: 30, fontWeight: 700, letterSpacing: '-0.02em', margin: '0 0 4px' };
const muted: React.CSSProperties = { color: MUTED, fontSize: 14.5, lineHeight: 1.6, margin: 0 };
const primary: React.CSSProperties = { padding: '11px 18px', borderRadius: 10, border: '1px solid ' + INK, background: INK, color: '#fff', fontSize: 14.5, fontWeight: 600, letterSpacing: '-0.005em', cursor: 'pointer', width: '100%', fontFamily: FONT };
const primaryAuto: React.CSSProperties = { ...primary, width: 'auto', whiteSpace: 'nowrap' };
const ghost: React.CSSProperties = { padding: '9px 15px', borderRadius: 9, border: '1px solid ' + LINE, background: '#fff', color: INK, fontSize: 13.5, fontWeight: 600, cursor: 'pointer', fontFamily: FONT };
const ghostWide: React.CSSProperties = { ...ghost, width: '100%', padding: '11px 16px', fontSize: 14.5 };
const eduBadge: React.CSSProperties = { display: 'inline-flex', alignItems: 'center', fontSize: 11, fontWeight: 700, letterSpacing: 0.7, textTransform: 'uppercase', color: CYAN_INK, border: '1px solid rgba(0, 180, 216, 0.35)', background: 'rgba(0, 180, 216, 0.08)', borderRadius: 999, padding: '4px 11px', marginBottom: 14 };
const fieldLabel: React.CSSProperties = { display: 'block', fontSize: 12.5, color: FAINT, margin: '14px 0 6px', fontWeight: 600 };
const input: React.CSSProperties = { flex: 1, minWidth: 0, width: '100%', boxSizing: 'border-box', padding: '11px 13px', borderRadius: 10, border: '1px solid ' + LINE, background: '#fff', color: INK, fontSize: 14.5, fontFamily: FONT };
const row: React.CSSProperties = { display: 'flex', gap: 8 };
const errText: React.CSSProperties = { color: '#dc2626', fontSize: 13.5, marginTop: 10 };
const topBar: React.CSSProperties = { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, marginBottom: 4 };
const createRow: React.CSSProperties = { display: 'flex', gap: 8, marginTop: 22 };
const card: React.CSSProperties = { border: '1px solid ' + LINE, borderRadius: 14, background: '#fff', marginBottom: 10, overflow: 'hidden' };
const cardTinted: React.CSSProperties = { border: '1px solid ' + LINE, borderRadius: 14, background: 'linear-gradient(180deg, rgba(0, 180, 216, 0.045), rgba(255, 255, 255, 0.6))' };
const eyebrowCyan: React.CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 11, fontWeight: 700, letterSpacing: 0.8, textTransform: 'uppercase', color: CYAN_INK, marginBottom: 9 };
const eyebrowTick: React.CSSProperties = { width: 16, height: 2, borderRadius: 2, background: CYAN, display: 'inline-block' };
const codePill: React.CSSProperties = { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 12, fontWeight: 700, letterSpacing: 0.5, color: CYAN_INK, background: 'rgba(0, 180, 216, 0.10)', border: '1px solid rgba(0, 180, 216, 0.28)', borderRadius: 7, padding: '3px 8px', whiteSpace: 'nowrap' };
const cardHead: React.CSSProperties = { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, width: '100%', padding: '15px 16px', background: 'transparent', border: 'none', color: INK, fontSize: 14.5, cursor: 'pointer', textAlign: 'left', fontFamily: FONT };
const table: React.CSSProperties = { width: '100%', borderCollapse: 'collapse', fontSize: 13.5 };
const th: React.CSSProperties = { textAlign: 'left', padding: '8px 6px', color: FAINT, fontWeight: 600, borderBottom: '1px solid ' + LINE };
const thc: React.CSSProperties = { ...th, textAlign: 'center' };
const thr: React.CSSProperties = { ...th, textAlign: 'right' };
const td: React.CSSProperties = { padding: '10px 6px', borderBottom: '1px solid ' + LINE_SOFT };
const tdc: React.CSSProperties = { ...td, textAlign: 'center' };
const tdr: React.CSSProperties = { ...td, textAlign: 'right', color: MUTED };
const studentLink: React.CSSProperties = { color: CYAN_INK, textDecoration: 'none', fontWeight: 600 };
const scorePill: React.CSSProperties = { display: 'inline-block', minWidth: 34, padding: '2px 8px', borderRadius: 999, border: '1px solid', fontWeight: 700, fontSize: 12.5 };
const homeLink: React.CSSProperties = { color: CYAN_INK, fontSize: 14, fontWeight: 600, textDecoration: 'none', display: 'inline-block', marginTop: 28 };
