/**
 * Local draft persistence for the long-form composer.
 *
 * Stored in localStorage so the user can close the World mini app, lose connectivity,
 * or switch tabs and still come back to a draft on the same device. Drafts are cleared
 * after a successful Post (the on-chain entry is the source of truth from then on).
 *
 * Cross-device sync is a follow-up: a `content_drafts` Supabase table keyed by wallet
 * address would slot in here behind the same get/set/clear interface.
 */

export type DraftPayload = {
  title: string;
  content: string;
  contentType: 'short' | 'long';
  savedAt: string; // ISO
};

const KEY = 'hi-draft-v1';

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
      typeof parsed.savedAt === 'string'
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
