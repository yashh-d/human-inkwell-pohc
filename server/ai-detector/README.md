---
title: Human Ink AI Detector
emoji: 🖊️
colorFrom: blue
colorTo: indigo
sdk: docker
app_port: 8000
pinned: false
short_description: Proof-of-human writing — AI-text detector worker
---

<!-- The block above is Hugging Face Space config (used only when this folder is
     deployed as a Docker Space). It is ignored everywhere else. See
     DEPLOY-HF-SPACE.md for the full deploy steps. -->

# Human Ink — AI-detector worker

A tiny, swappable inference service. The rest of the app never knows which model
runs here: it calls `POST /detect { text } -> { ai: 0..1 }` and Human Ink maps
that onto its neutral "open model" UI. Swapping the model is one env var.

```
client → /api/ai-detect (Vercel proxy, verifies contentHash) → this worker → 0..1 score
```

## Run locally (dev)

```bash
cd server/ai-detector
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env        # set HF_TOKEN (gated Llama base); DETECTOR_TOKEN optional
export $(grep -v '^#' .env | xargs)
uvicorn app:app --host 0.0.0.0 --port 8000
```

Then point the app at it: set `DETECTOR_URL=http://localhost:8000` (and matching
`DETECTOR_TOKEN`) in the Vercel/`.env` for `/api/ai-detect`.

```bash
curl -s localhost:8000/detect -H 'content-type: application/json' \
  -d '{"text":"Some essay text to score."}'
# {"ai":0.03,"backend":"editlens-3b"}
```

The Pangram backend is a faithful port of the EditLens repo's `scripts/inference.py`:
a 4-bucket classifier (0 = human … 3 = AI) whose continuous score is the
probability-weighted bucket index, `softmax(logits)·[0,1,2,3]/3`. Text is cleaned
(`clean_text`) and truncated to 1024 tokens — their validated setting. Pangram
treats predictions on **< 75 words** as unreliable (`PANGRAM_MIN_WORDS`).

## Backends (`DETECTOR_BACKEND`)

| value        | model                              | license           | use |
|--------------|------------------------------------|-------------------|-----|
| `pangram`    | EditLens Llama-3.2-3B (peft adapter) | CC-BY-NC-SA ⚠️ **non-commercial** | dev / research / eval only |
| `binoculars` | Falcon-7B observer/performer       | BSD-3 / Apache-2.0 | **commercial-clean** (stub — implement `.score()`) |

**Do not** serve production/commercial traffic with `pangram` unless you have a
commercial license or grant from Pangram. For production use `binoculars` or your
own model trained from the open EditLens method/dataset on a commercial base.

## Scaling (built in)

Concurrent requests do **not** each run a forward pass. `batcher.py` coalesces a
burst into one padded batch (`Detector.score_batch`) and caches by `contentHash`, so
a class publishing at once collapses into a handful of passes. `/detect` is async, so
the worker holds many connections while the single model works. Only one batch runs at
a time — that serialization is the point (no thread/GPU contention). When the queue is
full the worker returns **503** (shed load; the client falls back to the heuristic)
instead of OOM-ing. This is model-agnostic — the Binoculars backend inherits it.

Tune with env (all optional):

| var | default | meaning |
|-----|---------|---------|
| `DETECTOR_MAX_BATCH`       | 16     | max requests per forward pass |
| `DETECTOR_BATCH_WAIT_MS`   | 30     | how long to coalesce arrivals into a batch |
| `DETECTOR_QUEUE_MAX`       | 256    | in-flight cap before 503 backpressure |
| `DETECTOR_CACHE_SIZE`      | 2048   | `contentHash`→score LRU entries |
| `DETECTOR_MAX_TEXT_CHARS`  | 200000 | reject oversized payloads (413) |

`GET /health` reports live `stats`: `model_scored`, `cache_hits`, `cache_hit_rate`,
`overloaded`, `avg_batch_size`, `avg_latency_ms`, `queue_depth`.

**Stress test it:**
```bash
pip install httpx
python loadtest.py --url http://localhost:8000 --concurrency 200 --total 1000
# --unique N controls distinct texts (low N exercises the cache)
```

## Deploy recommendation (fast + cheap, ~hundreds concurrent)

- **One always-warm small GPU** (L4 / A10 on Modal / RunPod / Baseten), min 1 instance
  so there's no multi-minute cold start on a 3B model. With batching + cache a single
  such GPU handles medium bursts for well under $1/hr — cheaper than a fleet of
  scale-to-zero replicas that each cold-start.
- Detection is **decoupled from the Process Score** (a post-hoc reference), so it need
  not be synchronous. If you outgrow one GPU, run N replicas behind a load balancer and
  move the cache to a shared Redis/Upstash keyed by `contentHash`.
- Set `DETECTOR_TOKEN` and keep this worker private (only the Vercel proxy calls it).
