// ⚠️ PARKED — not deployed. The live /publish rubric feature runs the client-side
// demo heuristic (buildRubricAlignment in client/src/pages/PublishProofPage.tsx).
// To reactivate: (1) `npm i @anthropic-ai/claude-agent-sdk` at the repo root,
// (2) move this file back to api/ and run it via Vercel Sandbox (plain functions
// are too cramped for the SDK's subprocess), (3) set CLAUDE_CODE_OAUTH_TOKEN
// (from `claude setup-token`) in Vercel env, (4) point runAlignment at the endpoint.
import { query } from '@anthropic-ai/claude-agent-sdk';
import type { VercelRequest, VercelResponse } from '@vercel/node';

/**
 * POST /api/rubric-analyze — real rubric-alignment call, authed by YOUR CLAUDE
 * SUBSCRIPTION (no separate API key, no pay-as-you-go billing).
 *
 * Uses the Claude Agent SDK, whose usage draws from your Pro/Max plan's limits.
 * Generate a long-lived subscription token once and set it in the environment:
 *
 *     npm i -g @anthropic-ai/claude-code   # if you don't have the `claude` CLI
 *     claude setup-token                   # browser login w/ your plan → prints a ~1yr token
 *
 * Then set it as CLAUDE_CODE_OAUTH_TOKEN (Vercel → Settings → Env Vars) and redeploy.
 * Auth precedence gotcha: if ANTHROPIC_API_KEY is also set in the environment it
 * WINS over the subscription token — so we strip it from the env we pass below to
 * force subscription auth.
 *
 * Scoped to writing *process*, not content: we don't send the essay text (the
 * proof payload only carries a hash). The model is a second opinion that points
 * a professor at evidence — never a grade. If auth/creds are missing the call
 * throws and the frontend falls back to its local heuristic.
 */

type ProcessFacts = {
  revisions?: number;
  editEvents?: number;
  editDays?: number;
  spanDays?: number;
  typedPct?: number;
  bigPastes?: number;
  backspaces?: number;
  minutes?: number;
};

const MODEL = 'claude-opus-4-8';

const SYSTEM = `You help a professor judge whether a student's writing PROCESS aligns with their grading rubric.

You are given (1) the rubric criteria and (2) behavioral signals about HOW the document was written — number of revisions, days spent, share typed vs. pasted, deletions, large pastes. You have NOT read the essay's content; you only see process signals.

For each rubric criterion, assess how well the observed writing process supports it, citing the concrete numbers you were given. You are a second opinion that points a professor at evidence — never assign a grade, never claim to evaluate the quality of the writing itself, and never invent signals you weren't given. If the process says little about a criterion, say so honestly (alignment "unclear").

Respond with ONLY a JSON object, no prose, no markdown fences, in exactly this shape:
{"summary": string, "rows": [{"criterion": string, "alignment": "strong"|"partial"|"weak"|"unclear", "note": string}]}`;

function parseRubric(text: string): string[] {
  return text
    .split(/\n+/)
    .map((l) => l.replace(/^\s*(\d+[.)]|[-*•])\s*/, '').trim())
    .filter(Boolean)
    .slice(0, 8);
}

function extractJson(raw: string): any {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fenced ? fenced[1] : raw;
  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  if (start === -1 || end === -1) throw new Error('No JSON object in model output.');
  return JSON.parse(body.slice(start, end + 1));
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { rubric, process: facts } = (req.body || {}) as { rubric?: string; process?: ProcessFacts };
  const criteria = parseRubric(rubric || '');
  if (!criteria.length) {
    return res.status(400).json({ error: 'No rubric criteria provided.' });
  }

  const f = facts || {};
  const factLines = [
    `Saved revisions: ${f.revisions ?? 'n/a'}`,
    `Edit events: ${f.editEvents ?? 'n/a'}`,
    `Days edited: ${f.editDays ?? 'n/a'}${f.spanDays && f.editDays && f.spanDays > f.editDays ? ` (over a ${f.spanDays}-day span)` : ''}`,
    `Share typed (vs pasted): ${f.typedPct ?? 'n/a'}%`,
    `Large pastes: ${f.bigPastes ?? 'n/a'}`,
    `Deletions/rewrites (backspaces): ${f.backspaces ?? 'n/a'}`,
    `Active minutes in the doc: ${f.minutes ?? 'n/a'}`,
  ].join('\n');

  const userPrompt = `Rubric criteria (one per line):\n${criteria.map((c, i) => `${i + 1}. ${c}`).join('\n')}\n\nObserved writing-process signals:\n${factLines}\n\nFor each criterion, return how the observed process aligns with it. Output JSON only.`;

  // Force subscription (CLAUDE_CODE_OAUTH_TOKEN) auth by removing the API key
  // from the env we hand the SDK — otherwise it would take precedence.
  const env = { ...process.env };
  delete env.ANTHROPIC_API_KEY;

  try {
    let finalText = '';
    const assistantText: string[] = [];

    for await (const message of query({
      prompt: userPrompt,
      options: {
        model: MODEL,
        systemPrompt: SYSTEM,
        maxTurns: 1,            // single inference, no agentic loop
        disallowedTools: ['*'], // pure LLM call — no filesystem / tools
        permissionMode: 'dontAsk' as any,
        env,
      },
    } as any)) {
      const m = message as any;
      if (m.type === 'assistant' && m.message?.content) {
        for (const block of m.message.content) {
          if (block?.type === 'text' && typeof block.text === 'string') assistantText.push(block.text);
        }
      } else if (m.type === 'result' && m.subtype === 'success') {
        finalText = (typeof m.result === 'string' && m.result) || (typeof m.text === 'string' && m.text) || '';
      }
    }

    const raw = finalText || assistantText.join('');
    if (!raw.trim()) return res.status(502).json({ error: 'Empty model response.', fallback: true });

    const parsed = extractJson(raw);
    if (!parsed || !Array.isArray(parsed.rows)) {
      return res.status(502).json({ error: 'Malformed model response.', fallback: true });
    }
    return res.status(200).json(parsed);
  } catch (e) {
    console.error('rubric-analyze failed:', e);
    return res.status(502).json({ error: e instanceof Error ? e.message : String(e), fallback: true });
  }
}
