import type { VercelRequest, VercelResponse } from '@vercel/node';

/**
 * GET /api/scoring-config — server-tunable Process Score band thresholds (F2).
 *
 * Lets you move the green/red cutoffs WITHOUT a code deploy: set PROCESS_SCORE_GREEN
 * / PROCESS_SCORE_RED in the Vercel env and the change takes effect on the next
 * request (serverless functions read process.env at runtime). The frontend falls
 * back to its built-in defaults if this endpoint is missing or errors.
 *
 * Bias: green should require a genuinely strong score; red is reserved for clearly
 * low ones (a false red is a wrongful accusation). Keep green high, red low.
 */
export default function handler(_req: VercelRequest, res: VercelResponse) {
  const green = Number(process.env.PROCESS_SCORE_GREEN || 60);
  const red = Number(process.env.PROCESS_SCORE_RED || 30);
  res.setHeader('Cache-Control', 'public, max-age=60');
  res.status(200).json({
    green: Number.isFinite(green) ? green : 60,
    red: Number.isFinite(red) ? red : 30,
  });
}
