/**
 * Client for the accounts / assignments / submissions API surface.
 * Thin fetch wrappers over the service-role-backed routes in client/api/.
 *
 * The professor-only calls take the caller's Supabase access token, which the
 * server verifies (and matches to a seeded professor profile) before returning
 * anything sensitive.
 */
import type { ExtensionProof } from './lib/authorship';

function apiPath(path: string): string {
  const base = (process.env.REACT_APP_API_BASE || '').replace(/\/$/, '');
  const p = path.startsWith('/') ? path : `/${path}`;
  return base ? `${base}${p}` : p;
}

export type SubmissionSummary = {
  authorship_score: number | null;
  ai_score: number | null;
  integrity_score: number | null;
  band: 'green' | 'yellow' | 'red' | null;
};

export type CreateSubmissionInput = {
  proof: ExtensionProof;
  summary: SubmissionSummary;
  student_email?: string | null;
  student_name?: string | null;
  chain_id?: number;
  contract_address?: string;
  entry_id?: number;
  content_hash?: string;
  transaction_hash?: string;
};

async function jsonOrThrow(res: Response) {
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || `Request failed (${res.status})`);
  return json;
}

export async function createSubmission(
  input: CreateSubmissionInput,
): Promise<{ share_slug: string; summary: SubmissionSummary }> {
  const res = await fetch(apiPath('/api/submissions'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  return jsonOrThrow(res);
}

/** One persisted paste behind an amber cliff/bar — professor-only content. */
export type PasteEvent = {
  charCount: number;
  content: string;
  origin: 'external' | 'cited_source' | 'internal_move' | string;
  pastedAt: number | null;
  isLarge: boolean;
  truncated: boolean;
};

export type SubmissionView = {
  slug: string;
  summary: SubmissionSummary;
  published_at: string;
  onchain: {
    chain_id: number | null;
    contract_address: string | null;
    entry_id: number | null;
    content_hash: string | null;
    transaction_hash: string | null;
  };
  viewer: 'professor' | 'public';
  detail?: ExtensionProof | null;
  student?: { email: string | null; name: string | null };
  assignment?: { id: string; title: string; join_code: string } | null;
  // Professor-only: the actual text of each external/cited paste, for the charts.
  pasteEvents?: PasteEvent[] | null;
};

export async function fetchSubmission(slug: string, token?: string | null): Promise<SubmissionView> {
  const res = await fetch(apiPath(`/api/submission?slug=${encodeURIComponent(slug)}`), {
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
  });
  return jsonOrThrow(res);
}

export type DirectoryTree = {
  schools: Array<{
    id: string | null;
    name: string;
    professors: Array<{ id: string; name: string; assignments: Array<{ id: string; title: string }> }>;
  }>;
};

export async function fetchDirectory(): Promise<DirectoryTree> {
  const res = await fetch(apiPath('/api/directory'));
  return jsonOrThrow(res);
}

export async function attachSubmission(input: {
  slug: string;
  assignment_id?: string;
  join_code?: string;
}): Promise<{ assignment: { id: string; title: string } }> {
  const res = await fetch(apiPath('/api/submission-attach'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  return jsonOrThrow(res);
}

// ---- Professor-authenticated calls (bearer = Supabase access token) ----

export type ProfessorProfile = {
  id: string;
  username: string | null;
  name: string | null;
  linked_email: string | null;
  role: string;
  school_id: string | null;
};

export async function getMe(token: string): Promise<{ profile: ProfessorProfile; school: { id: string; name: string } | null }> {
  const res = await fetch(apiPath('/api/me'), { headers: { Authorization: `Bearer ${token}` } });
  return jsonOrThrow(res);
}

/** Update the signed-in professor's display name and/or optional linked email. */
export async function updateAccount(
  token: string,
  patch: { name?: string; linked_email?: string | null },
): Promise<{ profile: ProfessorProfile }> {
  const res = await fetch(apiPath('/api/professor-account'), {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(patch),
  });
  return jsonOrThrow(res);
}

export type AssignmentRow = { id: string; title: string; join_code: string; created_at: string; submission_count: number };

export async function listAssignments(token: string): Promise<AssignmentRow[]> {
  const res = await fetch(apiPath('/api/assignments'), { headers: { Authorization: `Bearer ${token}` } });
  const json = await jsonOrThrow(res);
  return json.assignments || [];
}

export async function createAssignment(token: string, title: string): Promise<AssignmentRow> {
  const res = await fetch(apiPath('/api/assignments'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ title }),
  });
  const json = await jsonOrThrow(res);
  return json.assignment;
}

export type RosterSubmission = {
  share_slug: string;
  student_email: string | null;
  student_name: string | null;
  authorship_score: number | null;
  ai_score: number | null;
  integrity_score: number | null;
  band: 'green' | 'yellow' | 'red' | null;
  published_at: string;
};

export async function fetchRoster(
  token: string,
  assignmentId: string,
): Promise<{ assignment: { id: string; title: string; join_code: string }; submissions: RosterSubmission[] }> {
  const res = await fetch(apiPath(`/api/assignments?id=${encodeURIComponent(assignmentId)}`), {
    headers: { Authorization: `Bearer ${token}` },
  });
  return jsonOrThrow(res);
}
