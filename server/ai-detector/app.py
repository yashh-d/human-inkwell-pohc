"""Human Ink AI-detector worker.

A tiny FastAPI service in front of a swappable detector backend. It exposes a
single scoring endpoint the Vercel proxy (/api/ai-detect) calls:

    POST /detect  { "text": "...", "contentHash"?: "..." }
                                      ->  { "ai": 0.0..1.0, "backend": "..." }
    GET  /health                      ->  { ok, backend, ready, stats }

Concurrency: requests do NOT each run their own forward pass. They go through a
micro-batcher (batcher.py) that coalesces a burst into one padded batch and caches
by contentHash, so a class publishing at once stays cheap. The endpoint is async so
the event loop can hold many concurrent connections while the single model works.

Which model runs is chosen ENTIRELY here, by one env var, and never leaks to the
client (the proxy maps the score onto Human Ink's neutral UI):

    DETECTOR_BACKEND = pangram | binoculars     (default: pangram)

License note: DETECTOR_BACKEND=pangram loads the CC-BY-NC-SA (non-commercial)
EditLens adapter — dev/research only. Point production at a commercial-clean
backend (binoculars / your own model) or a licensed Pangram deployment.

Run:  uvicorn app:app --host 0.0.0.0 --port 8000
Auth: set DETECTOR_TOKEN and clients must send  Authorization: Bearer <token>.
"""
from __future__ import annotations

import os

from fastapi import FastAPI, Header, HTTPException
from pydantic import BaseModel, Field

from batcher import MicroBatcher, Overloaded

BACKENDS = {
    "pangram": ("backends.pangram", "PangramDetector"),
    "binoculars": ("backends.binoculars", "BinocularsDetector"),
}

# Upper bound on accepted text (chars). The model truncates to ~1024 tokens anyway;
# this just stops a pathological payload from hogging tokenization/transport.
MAX_TEXT_CHARS = int(os.environ.get("DETECTOR_MAX_TEXT_CHARS", "200000"))

app = FastAPI(title="Human Ink AI-detector", version="1.1")
_detector = None  # lazy singleton, loaded on first use / startup
_batcher: MicroBatcher | None = None


def _load_detector():
    global _detector
    if _detector is not None:
        return _detector
    name = os.environ.get("DETECTOR_BACKEND", "pangram").lower()
    if name not in BACKENDS:
        raise RuntimeError(f"Unknown DETECTOR_BACKEND={name!r}; choose from {list(BACKENDS)}")
    module_name, cls_name = BACKENDS[name]
    module = __import__(module_name, fromlist=[cls_name])
    _detector = getattr(module, cls_name)()
    return _detector


def _ensure_batcher() -> MicroBatcher:
    global _batcher
    if _batcher is None:
        _batcher = MicroBatcher(_load_detector())
        _batcher.start()
    return _batcher


@app.on_event("startup")
def _warm():
    # Load the model at boot so the first real request isn't cold. Don't crash the
    # process if a GPU/model is briefly unavailable — /health will report not-ready.
    try:
        _ensure_batcher()
    except Exception as e:  # noqa: BLE001
        print(f"[ai-detector] startup load failed (will retry lazily): {e}")


@app.on_event("shutdown")
async def _drain():
    if _batcher is not None:
        await _batcher.stop()


def _check_auth(authorization: str | None):
    token = os.environ.get("DETECTOR_TOKEN")
    if not token:
        return  # auth disabled (dev)
    expected = f"Bearer {token}"
    if authorization != expected:
        raise HTTPException(status_code=401, detail="Unauthorized")


class DetectRequest(BaseModel):
    text: str = Field(..., min_length=1)
    contentHash: str | None = None


@app.get("/health")
def health():
    ready = _detector is not None
    body = {
        "ok": True,
        "backend": os.environ.get("DETECTOR_BACKEND", "pangram").lower(),
        "ready": ready,
    }
    if _batcher is not None:
        body["stats"] = _batcher.health()
    return body


@app.post("/detect")
async def detect(req: DetectRequest, authorization: str | None = Header(default=None)):
    _check_auth(authorization)
    text = req.text.strip()
    if not text:
        raise HTTPException(status_code=400, detail="Empty text")
    if len(req.text) > MAX_TEXT_CHARS:
        raise HTTPException(status_code=413, detail="Text too large")
    try:
        batcher = _ensure_batcher()
    except Exception as e:  # noqa: BLE001
        raise HTTPException(status_code=503, detail=f"model not ready: {e}") from e
    try:
        ai = await batcher.submit(req.text, req.contentHash)
    except Overloaded:
        # Shed load rather than thrash — client falls back to the heuristic.
        raise HTTPException(status_code=503, detail="detector overloaded, retry")
    except Exception as e:  # noqa: BLE001
        raise HTTPException(status_code=503, detail=f"scoring failed: {e}") from e
    ai = max(0.0, min(1.0, float(ai)))
    return {"ai": ai, "backend": _detector.name}
