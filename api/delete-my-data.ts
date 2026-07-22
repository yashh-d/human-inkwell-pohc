import type { VercelRequest, VercelResponse } from '@vercel/node';

/**
 * POST /api/delete-my-data  { email?, docId? } — delete-on-request (F7).
 *
 * Removes a person's captured rows from `writing_sessions` and `paste_events`,
 * matched by `author_email` and/or `doc_id`. Uses the SERVICE ROLE key
 * (server-side only) because the public anon role has no DELETE policy — so this
 * is the single, audited path for a FERPA/BIPA "delete my data" request.
 *
 * Requires SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY in the Vercel env. Falls back
 * to the REACT_APP_SUPABASE_URL name if that's what's set.
 *
 * Note: rows captured while signed OUT have no email, so email-only deletion can't
 * reach them — pass a docId to clear a specific document regardless of account.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { email, docId } = (req.body || {}) as { email?: string; docId?: string };
  if (!email && !docId) return res.status(400).json({ error: 'Provide email and/or docId.' });

  const baseUrl = (process.env.SUPABASE_URL || process.env.REACT_APP_SUPABASE_URL || '').replace(/\/+$/, '');
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!baseUrl || !serviceKey) {
    return res.status(503).json({ error: 'Service role not configured (SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY).' });
  }

  const headers = {
    apikey: serviceKey,
    Authorization: `Bearer ${serviceKey}`,
    Prefer: 'return=representation',
  };

  // Build the PostgREST filter. Both filters AND together when both are given.
  const filters: string[] = [];
  if (email) filters.push(`author_email=eq.${encodeURIComponent(email)}`);
  if (docId) filters.push(`doc_id=eq.${encodeURIComponent(docId)}`);
  const qs = filters.join('&');

  async function del(table: string): Promise<number> {
    const r = await fetch(`${baseUrl}/rest/v1/${table}?${qs}`, { method: 'DELETE', headers });
    if (!r.ok) throw new Error(`${table}: HTTP ${r.status} ${(await r.text().catch(() => '')).slice(0, 200)}`);
    const rows = await r.json().catch(() => []);
    return Array.isArray(rows) ? rows.length : 0;
  }

  try {
    const writing_sessions = await del('writing_sessions');
    const paste_events = await del('paste_events');
    return res.status(200).json({ ok: true, deleted: { writing_sessions, paste_events } });
  } catch (e) {
    console.error('delete-my-data failed:', e);
    return res.status(502).json({ error: e instanceof Error ? e.message : String(e) });
  }
}
