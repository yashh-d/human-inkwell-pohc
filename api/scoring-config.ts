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
 *
 * Defaults track the 100-point grading scale the Process Score uses
 * (85 + credit − deductions, where the deductions come almost entirely from
 * writing time measured against the length of the finished piece, and the credit
 * is earned by revising, returning to the work, and having a revision history):
 * honest work lands 80–100, and below 70 is a process that does not account for
 * the work.
 * Keep these in step with DEFAULT_BANDS in client/src/lib/authorship.ts.
 */
export default function handler(_req: VercelRequest, res: VercelResponse) {
  const green = Number(process.env.PROCESS_SCORE_GREEN || 80);
  const red = Number(process.env.PROCESS_SCORE_RED || 70);
  res.setHeader('Cache-Control', 'public, max-age=60');
  res.status(200).json({
    green: Number.isFinite(green) ? green : 80,
    red: Number.isFinite(red) ? red : 70,
  });
}
