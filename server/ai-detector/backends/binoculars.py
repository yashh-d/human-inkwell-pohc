"""Binoculars backend (commercial-clean) — STUB.

Binoculars (Hans et al., 2024) is a zero-shot detector: it scores text by the
ratio of an "observer" model's cross-entropy to a "performer" model's perplexity.
Both models are typically Falcon-7B / Falcon-7B-Instruct (Apache-2.0), and the
Binoculars method itself is BSD-3-Clause — so this backend is safe for
COMMERCIAL use, unlike the Pangram OSS adapter.

This is the intended production backend once wired. It's a stub today so the seam
is real and DETECTOR_BACKEND=binoculars is a valid target; fill in .score() with
the Binoculars implementation (pip install binoculars-detector, or vendor the
observer/performer forward passes) and return its score mapped to [0, 1].

Note: Binoculars is materially weaker than EditLens on some slices (e.g. a high
false-positive rate on non-native English) — calibrate the threshold before
using it to surface anything user-facing.
"""
from __future__ import annotations

from .base import Detector


class BinocularsDetector(Detector):
    name = "binoculars"

    def __init__(self) -> None:
        raise NotImplementedError(
            "Binoculars backend not implemented yet. Implement .score() "
            "(Falcon-7B observer/performer) and remove this guard."
        )

    def score(self, text: str) -> float:  # pragma: no cover - stub
        raise NotImplementedError
