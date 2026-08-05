"""Micro-batching queue in front of a single model instance.

Why this exists: a burst of concurrent /detect requests must NOT each trigger an
independent forward pass on the shared model — on CPU that oversubscribes threads
and blows up memory; on GPU it serializes badly. Instead we collect requests for a
few milliseconds and run ONE padded batch. A classroom publishing at once (a few
hundred concurrent connections) collapses into a handful of batched passes.

Design:
  - submit(text, content_hash) is async: it returns a cached score instantly, else
    enqueues (text, future) and awaits the future.
  - A single background loop drains the queue: gather up to MAX_BATCH items within a
    BATCH_WAIT_MS window, run detector.score_batch in a threadpool (torch blocks the
    thread; keep the event loop free), then resolve every future.
  - Only one batch runs at a time (the loop awaits each batch before the next), which
    is exactly the GPU/model serialization we want — no contention.
  - Backpressure: the queue is bounded. When full, submit() raises Overloaded and the
    HTTP layer returns 503 — shed load instead of OOM.
  - Cache: contentHash -> score (LRU). Identical text is scored once. contentHash is
    the same value the app attests on-chain, so it is a free, correct cache key.

Model-agnostic: it drives the Detector.score_batch interface, so the Binoculars (or
any future) backend inherits batching + caching with no changes here.
"""
from __future__ import annotations

import asyncio
import hashlib
import os
import time
from collections import OrderedDict
from dataclasses import dataclass, field

from backends.base import Detector

MAX_BATCH = int(os.environ.get("DETECTOR_MAX_BATCH", "16"))
BATCH_WAIT_MS = int(os.environ.get("DETECTOR_BATCH_WAIT_MS", "30"))
QUEUE_MAX = int(os.environ.get("DETECTOR_QUEUE_MAX", "256"))
CACHE_SIZE = int(os.environ.get("DETECTOR_CACHE_SIZE", "2048"))


class Overloaded(Exception):
    """Raised when the queue is full — the caller should return HTTP 503."""


@dataclass
class _Job:
    text: str
    key: str
    future: "asyncio.Future[float]"


@dataclass
class Stats:
    requests: int = 0
    cache_hits: int = 0
    model_scored: int = 0
    overloaded: int = 0
    errors: int = 0
    batches: int = 0
    batch_items: int = 0  # sum of batch sizes -> avg = batch_items / batches
    total_wait_ms: float = 0.0  # queue+inference latency across model_scored

    def snapshot(self, queue_depth: int, cache_len: int) -> dict:
        avg_batch = (self.batch_items / self.batches) if self.batches else 0.0
        avg_ms = (self.total_wait_ms / self.model_scored) if self.model_scored else 0.0
        hit_rate = (self.cache_hits / self.requests) if self.requests else 0.0
        return {
            "requests": self.requests,
            "cache_hits": self.cache_hits,
            "cache_hit_rate": round(hit_rate, 3),
            "model_scored": self.model_scored,
            "overloaded": self.overloaded,
            "errors": self.errors,
            "avg_batch_size": round(avg_batch, 2),
            "avg_latency_ms": round(avg_ms, 1),
            "queue_depth": queue_depth,
            "cache_size": cache_len,
        }


class MicroBatcher:
    def __init__(self, detector: Detector) -> None:
        self.detector = detector
        self._queue: asyncio.Queue[_Job] = asyncio.Queue(maxsize=QUEUE_MAX)
        self._cache: "OrderedDict[str, float]" = OrderedDict()
        self.stats = Stats()
        self._task: asyncio.Task | None = None

    def start(self) -> None:
        if self._task is None:
            self._task = asyncio.create_task(self._run(), name="micro-batcher")

    async def stop(self) -> None:
        if self._task is not None:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
            self._task = None

    @staticmethod
    def _key(text: str, content_hash: str | None) -> str:
        if content_hash:
            return content_hash.lower()
        return hashlib.sha256(text.encode("utf-8")).hexdigest()

    def _cache_get(self, key: str) -> float | None:
        val = self._cache.get(key)
        if val is not None:
            self._cache.move_to_end(key)  # LRU touch
        return val

    def _cache_put(self, key: str, val: float) -> None:
        self._cache[key] = val
        self._cache.move_to_end(key)
        while len(self._cache) > CACHE_SIZE:
            self._cache.popitem(last=False)

    async def submit(self, text: str, content_hash: str | None = None) -> float:
        self.stats.requests += 1
        key = self._key(text, content_hash)

        cached = self._cache_get(key)
        if cached is not None:
            self.stats.cache_hits += 1
            return cached

        loop = asyncio.get_running_loop()
        fut: "asyncio.Future[float]" = loop.create_future()
        job = _Job(text=text, key=key, future=fut)
        try:
            self._queue.put_nowait(job)
        except asyncio.QueueFull:
            self.stats.overloaded += 1
            raise Overloaded()
        return await fut

    async def _run(self) -> None:
        loop = asyncio.get_running_loop()
        while True:
            first = await self._queue.get()
            batch = [first]
            # Coalesce more arrivals within the wait window, up to MAX_BATCH.
            deadline = time.monotonic() + BATCH_WAIT_MS / 1000.0
            while len(batch) < MAX_BATCH:
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    break
                try:
                    job = await asyncio.wait_for(self._queue.get(), timeout=remaining)
                except asyncio.TimeoutError:
                    break
                batch.append(job)

            # De-duplicate identical text within the batch (same key -> score once).
            unique: "OrderedDict[str, list[_Job]]" = OrderedDict()
            for job in batch:
                unique.setdefault(job.key, []).append(job)

            texts = [jobs[0].text for jobs in unique.values()]
            t0 = time.monotonic()
            try:
                scores = await loop.run_in_executor(None, self.detector.score_batch, texts)
            except Exception as e:  # noqa: BLE001 — fail the batch, don't kill the loop
                self.stats.errors += len(batch)
                for jobs in unique.values():
                    for job in jobs:
                        if not job.future.done():
                            job.future.set_exception(e)
                continue

            elapsed_ms = (time.monotonic() - t0) * 1000.0
            self.stats.batches += 1
            self.stats.batch_items += len(texts)
            self.stats.model_scored += len(batch)
            self.stats.total_wait_ms += elapsed_ms * len(batch)

            for (key, jobs), score in zip(unique.items(), scores):
                self._cache_put(key, score)
                for job in jobs:
                    if not job.future.done():
                        job.future.set_result(score)

    def health(self) -> dict:
        return self.stats.snapshot(self._queue.qsize(), len(self._cache))
