/**
 * Professor authentication — a lightweight Supabase Auth session used ONLY by the
 * professor / education dashboard. Deliberately separate from Privy (the creator
 * flow that mints an on-chain wallet and asks for a public @handle): professors
 * never touch that. They get a plain account they own.
 *
 * IDENTITY IS A USERNAME, NOT AN EMAIL.
 *   • Professors log in with a username + password they own and can change.
 *   • Under the hood each username maps to a fixed internal Supabase Auth address
 *     (`<username>@prof.humanink.app`) so we can reuse Supabase's secure password
 *     hashing / session refresh — the professor never sees or types this.
 *   • Their real email is OPTIONAL: they can link it later to enable one-click
 *     "easy login" (Google), but it is never the identity.
 *
 * Requires REACT_APP_SUPABASE_URL and REACT_APP_SUPABASE_ANON_KEY at build time.
 */
import { createClient, type SupabaseClient, type Session } from '@supabase/supabase-js';

/** Internal domain that turns a username into a Supabase Auth login address.
 *  Deterministic, so username → email needs no server lookup. Professors never
 *  see this; the seed script uses the same rule. */
export const PROF_LOGIN_DOMAIN = 'prof.humanink.app';

/** username → the synthetic Supabase Auth email. Lowercased, trimmed. */
export function usernameToLoginEmail(username: string): string {
  return `${username.trim().toLowerCase()}@${PROF_LOGIN_DOMAIN}`;
}

let cached: SupabaseClient | null = null;

export function getProfessorAuthClient(): SupabaseClient | null {
  if (cached) return cached;
  const url = (process.env.REACT_APP_SUPABASE_URL || '').trim();
  const anon = (process.env.REACT_APP_SUPABASE_ANON_KEY || '').trim();
  if (!url || !anon) return null;
  cached = createClient(url, anon, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
  });
  return cached;
}

export function professorAuthConfigured(): boolean {
  return !!getProfessorAuthClient();
}

export async function getSession(): Promise<Session | null> {
  const c = getProfessorAuthClient();
  if (!c) return null;
  const { data } = await c.auth.getSession();
  return data.session;
}

export function onAuthChange(cb: (session: Session | null) => void): () => void {
  const c = getProfessorAuthClient();
  if (!c) return () => {};
  const { data } = c.auth.onAuthStateChange((_e, session) => cb(session));
  return () => data.subscription.unsubscribe();
}

/** Primary professor login: username + password. */
export async function signInWithUsername(
  username: string,
  password: string,
): Promise<{ error?: string }> {
  const c = getProfessorAuthClient();
  if (!c) return { error: 'Professor sign-in is not configured.' };
  const u = username.trim();
  if (!u || !password) return { error: 'Enter your username and password.' };
  const { error } = await c.auth.signInWithPassword({
    email: usernameToLoginEmail(u),
    password,
  });
  if (error) {
    // Supabase returns a generic "Invalid login credentials" — keep it friendly.
    return { error: 'Wrong username or password.' };
  }
  return {};
}

/** Change the signed-in professor's password. */
export async function updatePassword(newPassword: string): Promise<{ error?: string }> {
  const c = getProfessorAuthClient();
  if (!c) return { error: 'Not configured.' };
  if (!newPassword || newPassword.length < 8) {
    return { error: 'Password must be at least 8 characters.' };
  }
  const { error } = await c.auth.updateUser({ password: newPassword });
  return error ? { error: error.message } : {};
}

/**
 * Link a Google identity to the CURRENT professor account, so afterwards
 * "Continue with Google" signs into the same account. Requires being signed in
 * already (username/password) and the Google provider enabled in Supabase.
 */
export async function linkGoogle(): Promise<{ error?: string }> {
  const c = getProfessorAuthClient();
  if (!c) return { error: 'Not configured.' };
  const anyAuth = c.auth as unknown as {
    linkIdentity?: (args: {
      provider: string;
      options?: { redirectTo?: string };
    }) => Promise<{ error: { message: string } | null }>;
  };
  if (!anyAuth.linkIdentity) return { error: 'Identity linking is unavailable.' };
  const { error } = await anyAuth.linkIdentity({
    provider: 'google',
    options: { redirectTo: `${window.location.origin}/dashboard` },
  });
  return error ? { error: error.message } : {};
}

/** One-click sign-in via a previously linked Google identity. */
export async function signInWithGoogle(): Promise<{ error?: string }> {
  const c = getProfessorAuthClient();
  if (!c) return { error: 'Professor sign-in is not configured.' };
  const { error } = await c.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: `${window.location.origin}/dashboard` },
  });
  return error ? { error: error.message } : {};
}

export async function signOut(): Promise<void> {
  const c = getProfessorAuthClient();
  if (c) await c.auth.signOut();
}
