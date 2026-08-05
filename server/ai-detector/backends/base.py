"""Detector backend interface.

Every backend maps raw text -> a single AI-likelihood score in [0, 1]
(0 = fully human, 1 = fully AI). The HTTP layer (app.py) never knows which
concrete model is loaded — it just calls .score(text). Adding a backend =
implement this interface and register it in app.py's BACKENDS map.
"""
from __future__ import annotations

from abc import ABC, abstractmethod


class Detector(ABC):
    #: short, stable id returned to the caller as {"backend": ...} for debugging.
    name: str = "base"

    @abstractmethod
    def score(self, text: str) -> float:
        """Return AI-likelihood in [0, 1] for one text."""
        raise NotImplementedError

    def score_batch(self, texts: list[str]) -> list[float]:
        """Default: score one at a time. Override for true batched inference."""
        return [self.score(t) for t in texts]
