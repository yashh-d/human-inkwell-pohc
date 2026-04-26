/**
 * Deployment root shim: if Vercel "Root" is the repo (not `client/`), the real
 * handler lives in `client/api/`. Vercel only auto-registers `api/*` at the
 * project root, not under `client/api/`.
 */
module.exports = require('../client/api/debug-supabase.js');
