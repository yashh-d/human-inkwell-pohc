"""Concurrency load test for the AI-detector worker.

Fires N concurrent /detect requests (optionally looping to a total count) and reports
throughput and latency percentiles — the numbers that tell you whether the worker
survives a burst. Pairs with the batcher: watch avg_batch_size climb and latency stay
bounded as concurrency rises.

Usage:
  # 200 concurrent, 1000 total requests, mostly-unique text (worst case for cache):
  python loadtest.py --url http://localhost:8000 --concurrency 200 --total 1000

  # measure cache behaviour: reuse a small pool of texts
  python loadtest.py --concurrency 200 --total 1000 --unique 20

  --token sets the Authorization bearer if the worker has DETECTOR_TOKEN set.

Reads /health before and after so you can see model_scored / cache_hits / overloaded
/ avg_batch_size move. Requires: pip install httpx
"""
from __future__ import annotations

import argparse
import asyncio
import statistics
import time

import httpx

SAMPLE = (
    "The industrial revolution reshaped labor, cities, and family life in ways that "
    "still echo today. Factories pulled workers from farms into dense urban centers, "
    "and the rhythm of daily life shifted from seasons to shifts. This essay examines "
    "three of those changes and argues that the least visible one mattered most."
)


def _texts(n_unique: int) -> list[str]:
    # n_unique distinct payloads; the runner cycles through them.
    return [f"[v{i}] {SAMPLE}" for i in range(max(1, n_unique))]


async def _health(client: httpx.AsyncClient, url: str) -> dict:
    try:
        r = await client.get(f"{url}/health", timeout=10)
        return r.json()
    except Exception as e:  # noqa: BLE001
        return {"error": str(e)}


async def run(url: str, concurrency: int, total: int, n_unique: int, token: str | None) -> None:
    url = url.rstrip("/")
    texts = _texts(n_unique)
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"

    sem = asyncio.Semaphore(concurrency)
    latencies: list[float] = []
    status_counts: dict[int, int] = {}
    errors = 0

    async with httpx.AsyncClient(headers=headers, timeout=60) as client:
        before = await _health(client, url)

        async def one(i: int):
            nonlocal errors
            body = {"text": texts[i % len(texts)], "contentHash": None}
            async with sem:
                t0 = time.monotonic()
                try:
                    r = await client.post(f"{url}/detect", json=body)
                    latencies.append((time.monotonic() - t0) * 1000.0)
                    status_counts[r.status_code] = status_counts.get(r.status_code, 0) + 1
                except Exception:  # noqa: BLE001
                    errors += 1

        wall0 = time.monotonic()
        await asyncio.gather(*(one(i) for i in range(total)))
        wall = time.monotonic() - wall0

        after = await _health(client, url)

    ok = status_counts.get(200, 0)
    print(f"\n=== load test: {concurrency} concurrent, {total} total, {n_unique} unique texts ===")
    print(f"wall time      : {wall:.2f}s")
    print(f"throughput     : {total / wall:.1f} req/s")
    print(f"status codes   : {dict(sorted(status_counts.items()))}  transport_errors={errors}")
    if latencies:
        latencies.sort()

        def pct(p: float) -> float:
            return latencies[min(len(latencies) - 1, int(p / 100 * len(latencies)))]

        print(f"latency ms     : p50={statistics.median(latencies):.0f}  "
              f"p95={pct(95):.0f}  p99={pct(99):.0f}  max={latencies[-1]:.0f}")
    print(f"success (200)  : {ok}/{total}")
    print(f"worker stats   : {after.get('stats', after)}")
    if isinstance(before.get("stats"), dict) and isinstance(after.get("stats"), dict):
        db = after["stats"].get("model_scored", 0) - before["stats"].get("model_scored", 0)
        dc = after["stats"].get("cache_hits", 0) - before["stats"].get("cache_hits", 0)
        print(f"delta          : model_scored+={db}  cache_hits+={dc}  "
              f"avg_batch={after['stats'].get('avg_batch_size')}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--url", default="http://localhost:8000")
    ap.add_argument("--concurrency", type=int, default=200)
    ap.add_argument("--total", type=int, default=1000)
    ap.add_argument("--unique", type=int, default=200,
                    help="number of distinct texts (low = exercises the cache)")
    ap.add_argument("--token", default=None)
    args = ap.parse_args()
    asyncio.run(run(args.url, args.concurrency, args.total, args.unique, args.token))


if __name__ == "__main__":
    main()
