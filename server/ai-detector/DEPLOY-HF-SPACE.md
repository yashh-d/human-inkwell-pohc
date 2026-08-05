# Deploy the AI-detector on Hugging Face (Docker Space, GPU)

Goal: replace the heuristic "demo" score on `/publish` with the real Pangram
EditLens model, running on Hugging Face, in ~20 minutes. No code changes to the
website are needed — you only stand up the worker and set two Vercel env vars.

```
/publish → /api/ai-detect (Vercel, verifies contentHash) → HF Space (this worker) → 0..1 score
```

The worker pulls the model straight from Hugging Face at boot:
`meta-llama/Llama-3.2-3B` (gated base) + `pangram/editlens_Llama-3.2-3B` (adapter).

> ⚠️ **License:** the Pangram adapter is **CC-BY-NC-SA (non-commercial)** — fine for
> validation/dev, NOT for commercial/paying-school production. It's one env var to
> swap later (`DETECTOR_BACKEND`), so validate now, swap before you charge. See the
> table in `README.md`.

---

## Prerequisites (one time)

1. A Hugging Face account with **billing enabled** (GPU Spaces are paid).
2. Accept the base-model license: open
   https://huggingface.co/meta-llama/Llama-3.2-3B and click **Agree**.
3. A HF **access token** with read access: https://huggingface.co/settings/tokens
   → this is `HF_TOKEN`.
4. Pick a shared secret for `DETECTOR_TOKEN` (any long random string) — the worker
   requires it and the Vercel proxy sends it, so only your site can call the worker.

## Step 1 — Create the Space

1. https://huggingface.co/new-space
2. **Space SDK: Docker** → **Blank**. Name it e.g. `humanink-ai-detector`.
3. **Hardware:** a GPU tier — **Nvidia T4 small** is enough (3B in 4-bit ≈ 2–3 GB).
4. Visibility: **Public** is fine (the worker is gated by `DETECTOR_TOKEN`). Private
   also works but then the proxy must send an HF token too — Public + token is simpler.

## Step 2 — Push these files to the Space

The Space repo is a git repo. Push the CONTENTS of `server/ai-detector/`
(`Dockerfile`, `app.py`, `backends/`, `requirements.txt`, `README.md` — its
frontmatter is the Space config). Do **not** push `.venv/` or `.env`.

```bash
cd server/ai-detector
git init -b main                       # if not already a repo
git remote add space https://huggingface.co/spaces/<you>/humanink-ai-detector
# make sure junk stays out (.gitignore already excludes .venv, .env, __pycache__)
git add Dockerfile app.py backends requirements.txt README.md smoke_test.py .gitignore
git commit -m "Human Ink AI-detector worker"
git push space main
```

The Space will build the Docker image and boot. First build is slow (torch image).

## Step 3 — Set the Space secrets

Space → **Settings → Variables and secrets** → add:

| Name               | Value                        | Kind   |
|--------------------|------------------------------|--------|
| `HF_TOKEN`         | your HF read token           | secret |
| `DETECTOR_TOKEN`   | your long random shared secret | secret |
| `DETECTOR_BACKEND` | `pangram`                    | variable |

Restart the Space. Watch the logs: you want `Application startup complete` and no
model-load error. First boot downloads the weights (~a few GB) — give it a minute.

## Step 4 — Point Vercel at it

The Space URL looks like `https://<you>-humanink-ai-detector.hf.space`.
In the website's **Vercel project → Settings → Environment Variables**, add:

| Name             | Value                                            |
|------------------|--------------------------------------------------|
| `DETECTOR_URL`   | `https://<you>-humanink-ai-detector.hf.space`    |
| `DETECTOR_TOKEN` | the SAME shared secret as the Space              |

Redeploy the site (env changes need a redeploy). That's it — `/api/ai-detect` now
forwards to the worker instead of returning 503, and `/publish` shows the real
model score instead of the heuristic.

## Step 5 — Verify it works

```bash
# hit the worker directly (replace URL + token)
curl -s https://<you>-humanink-ai-detector.hf.space/detect \
  -H 'content-type: application/json' \
  -H 'authorization: Bearer <DETECTOR_TOKEN>' \
  -d '{"text":"Repairing a fence is a rewarding weekend project that enhances both the security and aesthetic appeal of your property. Begin by assessing the damage, then gather the necessary tools and materials."}'
# expect a HIGH score, e.g. {"ai":0.9x,"backend":"editlens-3b"}
```

Then on the site: open `/publish` with a real proof that carries text and confirm
the AI section shows a model result (the client marks `source: 'model'`; the
heuristic path is `source: 'fallback'`). The bundled `smoke_test.py --url <space>`
runs the human-vs-AI ordering check.

## Notes / gotchas

- **Cold start:** if you enable "sleep after inactivity" to save money, the first
  request after sleep reloads the model (~30–60 s) and will exceed the proxy's 25 s
  timeout, so that one request falls back to the heuristic — the next succeeds. Keep
  the Space awake (no sleep) for consistent results, or raise the timeouts in
  `api/ai-detect.ts` / `client/src/lib/aiDetector.ts`.
- **Persistence:** without HF persistent storage the weights re-download on every
  cold boot. Enable Space persistent storage and set `HF_HOME=/data/.cache/huggingface`
  to cache them across restarts.
- **Swapping to a commercial model later:** implement `binoculars` (or your own
  trained model) in `backends/`, set `DETECTOR_BACKEND` on the Space, restart. No
  website change.

## Alternative: HF Inference Endpoint

If you prefer a managed autoscaling endpoint over a Space, the same Docker image
deploys to a Hugging Face **Inference Endpoint** (custom container). The env vars
and the `DETECTOR_URL`/`DETECTOR_TOKEN` wiring are identical; only the create-UI
differs.
