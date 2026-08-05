"""Pangram EditLens backend (Llama-3.2-3B QLoRA adapter).

Faithful port of Pangram's own scripts/inference.py + train.py (EditLens repo):
the checkpoint is a 4-BUCKET sequence classifier (bucket 0 = human ... bucket 3
= AI) with a custom LayerNorm+Linear "score" head (NormedLinear). The continuous
0..1 score is the probability-weighted bucket index:

    probs = softmax(logits)           # over 4 buckets
    score = (probs · [0,1,2,3]) / 3   # 0 = human, 1 = AI

Load recipe (matches inference.py): build the base with num_labels=4, swap in a
NormedLinear head, then apply the PEFT adapter (whose modules_to_save restores the
trained head). Text is cleaned exactly as in preprocess.py and truncated to 1024
tokens (their validated setting — no chunking).

CUDA gets 4-bit nf4 quant (as trained). MPS/CPU load unquantized (bitsandbytes is
CUDA-only) — slower but this is what "runs on a MacBook" means in practice.

LICENSE: the adapter is CC-BY-NC-SA 4.0 — NON-COMMERCIAL. Dev/research/eval only;
see README. Base meta-llama/Llama-3.2-3B is gated — set HF_TOKEN.
"""
from __future__ import annotations

import os
import re

import torch
from peft import PeftModel
from transformers import AutoModelForSequenceClassification, AutoTokenizer

from .base import Detector

BASE_MODEL = os.environ.get("PANGRAM_BASE_MODEL", "meta-llama/Llama-3.2-3B")
ADAPTER = os.environ.get("PANGRAM_ADAPTER", "pangram/editlens_Llama-3.2-3B")
MAX_TOKENS = int(os.environ.get("PANGRAM_MAX_TOKENS", "1024"))
N_BUCKETS = int(os.environ.get("PANGRAM_N_BUCKETS", "4"))
# Below this word count Pangram considers the prediction unreliable (their public
# "minimum word count"); we still score but callers may choose to de-weight it.
MIN_WORDS = int(os.environ.get("PANGRAM_MIN_WORDS", "75"))


# --- exact copies of Pangram's NormedLinear (train.py) + clean_text (preprocess.py) ---
class NormedLinear(torch.nn.Module):
    """Linear layer preceded by LayerNorm to keep logits well-scaled."""

    def __init__(self, hidden_size, num_labels, device=None, dtype=None):
        super().__init__()
        self.norm = torch.nn.LayerNorm(hidden_size, device=device, dtype=dtype)
        self.linear = torch.nn.Linear(hidden_size, num_labels, bias=False, device=device, dtype=dtype)

    def forward(self, x):
        return self.linear(self.norm(x))


_BOILERPLATE_STARTS = ["Sure", "Here", "Abstract", "Title", "I'm happy to help", "Certainly"]


def _normalize_whitespace(text: str) -> str:
    return re.sub(r"\s+", " ", text).strip()


def _remove_think_tag(text: str) -> str:
    if "</think>" in text:
        text = text.split("</think>")[1].strip()
    return text


def _remove_ai_header(text: str) -> str:
    paragraphs = [p for p in text.split("\n") if p.strip()]
    if not paragraphs:
        return text
    first = re.sub(r"^[^a-zA-Z0-9]*", "", paragraphs[0])
    try:
        import emoji
        first = emoji.replace_emoji(first, "")
    except Exception:
        pass
    if any(first.startswith(p) for p in _BOILERPLATE_STARTS) and len(paragraphs) > 1:
        text = "\n".join(paragraphs[1:])
    return text


def clean_text(text: str) -> str:
    try:
        import emoji
        text = emoji.demojize(text)
    except Exception:
        pass
    text = _remove_think_tag(text)
    text = _remove_ai_header(text)
    text = text.lower()
    text = _normalize_whitespace(text)
    return text


def count_words(text: str) -> int:
    return len(re.findall(r"\b\w+\b", text))


def _pick_device_dtype():
    if torch.cuda.is_available():
        return "cuda", torch.bfloat16
    if getattr(torch.backends, "mps", None) and torch.backends.mps.is_available():
        return "mps", torch.float32  # bf16 on MPS is flaky
    return "cpu", torch.bfloat16  # halve memory vs fp32 (~6GB not ~12GB for 3B)


class PangramDetector(Detector):
    name = "editlens-3b"  # deliberately neutral — never leaks vendor to clients

    def __init__(self) -> None:
        self.device, dtype = _pick_device_dtype()
        token = os.environ.get("HF_TOKEN")

        self.tokenizer = AutoTokenizer.from_pretrained(BASE_MODEL, token=token)
        if self.tokenizer.pad_token is None:
            self.tokenizer.pad_token = self.tokenizer.eos_token
            self.tokenizer.padding_side = "left"

        load_kwargs = dict(num_labels=N_BUCKETS, token=token)
        if self.device == "cuda":
            # 4-bit nf4 as trained (bitsandbytes is CUDA-only).
            from transformers import BitsAndBytesConfig
            load_kwargs["quantization_config"] = BitsAndBytesConfig(
                load_in_4bit=True,
                bnb_4bit_quant_type="nf4",
                bnb_4bit_compute_dtype=torch.bfloat16,
            )
        else:
            load_kwargs["dtype"] = dtype  # transformers 5.x renamed torch_dtype -> dtype

        base = AutoModelForSequenceClassification.from_pretrained(BASE_MODEL, **load_kwargs)
        base.config.pad_token_id = self.tokenizer.pad_token_id
        # Swap the default Linear score head for the trained NormedLinear so the
        # adapter's saved head weights load into the right module (as inference.py does).
        if hasattr(base, "score") and isinstance(base.score, torch.nn.Linear):
            hidden = base.config.hidden_size
            dev = next(base.parameters()).device
            base.score = NormedLinear(hidden, N_BUCKETS, device=dev)

        self.model = PeftModel.from_pretrained(base, ADAPTER, token=token)
        if self.device != "cuda":
            # Unify dtype: the base loads in `dtype` (bf16 on CPU) but the swapped-in
            # NormedLinear score head + the adapter's saved head weights default to
            # fp32 → matmul dtype mismatch at the head. Cast the whole model to one
            # dtype. (The CUDA 4-bit path handles compute dtype via bitsandbytes.)
            self.model = self.model.to(device=self.device, dtype=dtype)
        else:
            # CUDA: the 4-bit body computes in bf16, but the fp32 score head (swapped
            # in + restored by the adapter) triggers "expected BFloat16 but found Float"
            # at the classifier. Cast only the fp32 params (the head) to bf16 — the
            # quantized body is uint8-backed and must not be touched.
            for p in self.model.parameters():
                if p.dtype == torch.float32:
                    p.data = p.data.to(torch.bfloat16)
        self.model.eval()

        self._bucket_idx = torch.arange(N_BUCKETS, dtype=torch.float32)

    @torch.no_grad()
    def score(self, text: str) -> float:
        return self.score_batch([text])[0]

    @torch.no_grad()
    def score_batch(self, texts: list[str]) -> list[float]:
        # One padded forward pass for the whole batch — this is what lets a burst
        # of concurrent requests collapse into a handful of GPU passes instead of
        # one-per-request. padding_side is 'left' (set in __init__), matching how a
        # causal-LM-derived classifier reads the final token.
        cleaned = [clean_text(t) for t in texts]
        enc = self.tokenizer(
            cleaned,
            truncation=True,
            max_length=MAX_TOKENS,
            padding=True,
            return_tensors="pt",
        )
        enc = {k: v.to(self.device) for k, v in enc.items()}
        logits = self.model(**enc).logits.float().cpu()  # [batch, n_buckets]
        probs = torch.softmax(logits, dim=-1)
        # Continuous score = probability-weighted bucket index, normalized to [0,1].
        scores = (probs * self._bucket_idx).sum(dim=-1) / (N_BUCKETS - 1)
        return [max(0.0, min(1.0, float(s))) for s in scores]
