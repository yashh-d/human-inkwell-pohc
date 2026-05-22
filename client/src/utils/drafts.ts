/**
 * Draft persistence for the writing workspace.
 *
 * Two layers behind the same shape:
 *   • localStorage  — instant, works without a wallet, survives reload.
 *   • Supabase      — cross-device, keyed by wallet address via /api/drafts-*.
 *
 * MiniKit-first: remote save no longer requires an ECDSA signer. The wallet
 * address (proven once via MiniKit walletAuth or supplied by Privy) is the
 * row key. This lets World App users sync drafts the same way browser users
 * do — Safe wallets can't ECDSA-personal-sign, so the old signed-message
 * scheme silently dropped them.
 *
 * Drafts are cleared after a successful Post (the onchain entry is the source
 * of truth from then on).
 */

export type KeystrokeEvent = {
  key: string;
  eventType: 'keydown' | 'keyup';
  timestamp: number;
};

export type PauseWindow = {
  startedAt: number;
  endedAt: number;
};

export type DraftPayload = {
  title: string;
  content: string;
  contentType: 'short' | 'long';
  savedAt: string; // ISO
  keystrokeEvents: KeystrokeEvent[];
  pauseWindows: PauseWindow[];
  sessionStartedAt: number; // ms epoch of first capture start
};

const KEY = 'hi-draft-v2';

function storage(): Storage | null {
  try {
    if (typeof window === 'undefined') return null;
    return window.localStorage;
  } catch {
    return null;
  }
}

export function loadDraft(): DraftPayload | null {
  const s = storage();
  if (!s) return null;
  try {
    const raw = s.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<DraftPayload>;
    if (
      parsed &&
      typeof parsed.content === 'string' &&
      typeof parsed.title === 'string' &&
      (parsed.contentType === 'short' || parsed.contentType === 'long') &&
      typeof parsed.savedAt === 'string' &&
      Array.isArray(parsed.keystrokeEvents) &&
      Array.isArray(parsed.pauseWindows) &&
      typeof parsed.sessionStartedAt === 'number'
    ) {
      return parsed as DraftPayload;
    }
    return null;
  } catch {
    return null;
  }
}

export function saveDraft(payload: Omit<DraftPayload, 'savedAt'>): DraftPayload | null {
  const s = storage();
  if (!s) return null;
  const full: DraftPayload = { ...payload, savedAt: new Date().toISOString() };
  try {
    s.setItem(KEY, JSON.stringify(full));
    return full;
  } catch {
    return null;
  }
}

export function clearDraft(): void {
  const s = storage();
  if (!s) return;
  try {
    s.removeItem(KEY);
  } catch {
    /* ignore */
  }
}

/** Pretty-print a short "Saved 2:34 PM" style string. */
export function formatSavedAt(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

// ───────────────────────── Remote (Supabase) sync ─────────────────────────

export type RemoteDraftRow = {
  id: string;
  author_address: string;
  draft_key: string;
  title: string;
  content: string;
  content_type: 'short' | 'long';
  keystroke_events: KeystrokeEvent[];
  pause_windows: PauseWindow[];
  session_started_at: number;
  created_at: string;
  updated_at: string;
};

function apiPath(path: string): string {
  const base = (process.env.REACT_APP_API_BASE || '').replace(/\/$/, '');
  if (base) {
    return `${base}${path.startsWith('/') ? path : `/${path}`}`;
  }
  return path.startsWith('/') ? path : `/${path}`;
}

async function parseErrorBody(res: Response): Promise<string> {
  const body = await res.text();
  try {
    const j = JSON.parse(body) as { error?: string };
    if (j?.error) return j.error;
  } catch {
    /* not json */
  }
  return body || res.statusText;
}

function normalizeAddress(addr: string): string {
  const a = (addr || '').toLowerCase();
  if (!/^0x[0-9a-f]{40}$/.test(a)) {
    throw new Error('Invalid author address');
  }
  return a;
}

/**
 * Upsert the current draft to Supabase for cross-device resume.
 * No signature: the address is the row key. See drafts-list.js for rationale.
 */
export async function saveDraftRemote(
  authorAddress: string,
  payload: Omit<DraftPayload, 'savedAt'>,
  draftKey: string = 'default'
): Promise<{ id: string; updated_at: string } | null> {
  const addr = normalizeAddress(authorAddress);
  const res = await fetch(apiPath('/api/drafts-save'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      author_address: addr,
      draft_key: draftKey,
      title: payload.title,
      content: payload.content,
      content_type: payload.contentType,
      keystroke_events: payload.keystrokeEvents,
      pause_windows: payload.pauseWindows,
      session_started_at: payload.sessionStartedAt,
    }),
  });
  if (!res.ok) {
    throw new Error(await parseErrorBody(res));
  }
  const data = (await res.json()) as { ok?: boolean; id?: string; updated_at?: string };
  if (!data?.ok || !data.id || !data.updated_at) return null;
  return { id: data.id, updated_at: data.updated_at };
}

/** List all drafts belonging to a wallet, newest first. */
export async function listDraftsRemote(authorAddress: string): Promise<RemoteDraftRow[]> {
  const addr = normalizeAddress(authorAddress);
  const res = await fetch(`${apiPath('/api/drafts-list')}?author=${addr}`, { method: 'GET' });
  if (!res.ok) {
    throw new Error(await parseErrorBody(res));
  }
  const data = (await res.json()) as { ok?: boolean; rows?: RemoteDraftRow[] };
  if (!data?.ok || !data.rows) return [];
  return data.rows;
}

/** Delete one draft (after a successful Post, or by user request). */
export async function deleteDraftRemote(
  authorAddress: string,
  draftKey: string = 'default'
): Promise<void> {
  const addr = normalizeAddress(authorAddress);
  const res = await fetch(apiPath('/api/drafts-delete'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ author_address: addr, draft_key: draftKey }),
  });
  if (!res.ok) {
    throw new Error(await parseErrorBody(res));
  }
}

/** Map a remote row back into the local DraftPayload shape. */
export function remoteRowToDraftPayload(row: RemoteDraftRow): DraftPayload {
  return {
    title: row.title || '',
    content: row.content || '',
    contentType: row.content_type,
    savedAt: row.updated_at,
    keystrokeEvents: row.keystroke_events || [],
    pauseWindows: row.pause_windows || [],
    sessionStartedAt: Number(row.session_started_at) || 0,
  };
}

/** Persist a remote row into localStorage so the existing HomePage restore
 *  path (loadDraft) picks it up. Used by "Resume" in My Content. */
export function hydrateLocalFromRemote(row: RemoteDraftRow): DraftPayload | null {
  const s = storage();
  if (!s) return null;
  const payload = remoteRowToDraftPayload(row);
  try {
    s.setItem(KEY, JSON.stringify(payload));
    return payload;
  } catch {
    return null;
  }
}
