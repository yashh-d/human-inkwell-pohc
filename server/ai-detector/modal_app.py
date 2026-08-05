"""Deploy the AI-detector on Modal — scale-to-zero GPU, per-second billing, with the
model weights PRELOADED into a Volume so a cold container loads from disk instead of
re-downloading ~6GB. Reuses app.py + batcher.py + backends/ verbatim (Modal just runs
the existing FastAPI app on a GPU).

Why Modal for this model: the detector is a custom sequence *classifier* (Llama-3.2-3B
with a swapped NormedLinear head + PEFT adapter), not a generation model — so vLLM-based
serverless / hosted-model routers don't apply. Modal runs the arbitrary Python load
recipe as-is.

--- one-time setup ---
  pip install modal
  modal token new
  # gated Llama base needs an HF token; DETECTOR_TOKEN is the shared bearer (optional):
  modal secret create huggingface HF_TOKEN=hf_xxxxxxxx
  modal secret create ai-detector DETECTOR_TOKEN=some-long-random-string
  # populate the weights Volume ONCE (a few min); every future cold start reads from it:
  modal run modal_app.py::download_weights

--- deploy ---
  modal deploy modal_app.py
  # prints a public URL like https://<you>--human-ink-ai-detector-web.modal.run
  # Point the app at it (Vercel env):  DETECTOR_URL=<that url>   DETECTOR_TOKEN=<same>
  # (The FastAPI routes /detect and /health are served under that URL.)

--- cost knob (bottom of file) ---
  min_containers=0  -> cheapest: scales to zero, ~$0 at idle. First hit after an idle
                       gap pays a cold start (weights load from the Volume, ~seconds).
  min_containers=1  -> one always-warm GPU so NOBODY ever hits a cold start (costs one
                       small GPU 24/7). Flip this without touching any other code.
"""
import os
from pathlib import Path

import modal

APP_DIR = Path(__file__).parent

# Runtime knobs read at DEPLOY time (deploy.sh sets these) — no code edit to flip:
#   DETECTOR_MIN_CONTAINERS  0 = scale-to-zero / pay-by-seconds (cheap, cold starts)
#                            1 = one always-warm GPU (no cold starts, billed 24/7)
#   DETECTOR_SCALEDOWN_WINDOW seconds a used worker stays warm after the last request
#                            (the cost/speed tuner within the cheap path)
#   DETECTOR_GPU             GPU type (L4 is the cheapest that fits a 3B model)
MIN_CONTAINERS = int(os.environ.get("DETECTOR_MIN_CONTAINERS", "0"))
SCALEDOWN_WINDOW = int(os.environ.get("DETECTOR_SCALEDOWN_WINDOW", "60"))
GPU = os.environ.get("DETECTOR_GPU", "L4")

# GPU image: the project's own requirements + bitsandbytes (CUDA-only 4-bit, as the
# adapter was trained). HF_HOME points at the mounted Volume so weights live there.
image = (
    modal.Image.debian_slim(python_version="3.11")
    .pip_install_from_requirements(str(APP_DIR / "requirements.txt"))
    .pip_install("bitsandbytes>=0.43", "huggingface_hub[hf_transfer]")
    .env({"HF_HOME": "/weights", "HF_HUB_ENABLE_HF_TRANSFER": "1"})
    .add_local_dir(str(APP_DIR), remote_path="/root")
)

app = modal.App("human-ink-ai-detector", image=image)

# Persistent weights cache — populated once by download_weights(), read by every worker.
weights = modal.Volume.from_name("human-ink-weights", create_if_missing=True)

hf_secret = modal.Secret.from_name("huggingface-secret")  # provides HF_TOKEN

# Force local weight load: weights live in the Volume and the base model is gated,
# so offline skips a needless auth round-trip on every cold start.
offline_secret = modal.Secret.from_dict({"HF_HUB_OFFLINE": "1", "TRANSFORMERS_OFFLINE": "1"})

# Bearer auth: the "ai-detector" secret provides DETECTOR_TOKEN. The worker enforces
# auth iff DETECTOR_TOKEN is set (app.py:_check_auth), so attaching this secret turns
# auth ON — required before real traffic, else anyone who finds the public URL can run
# up GPU charges.
#
# Attached UNCONDITIONALLY on purpose: a deploy-time conditional (e.g. reading an env
# var here) evaluates differently in the container, which re-imports this module WITHOUT
# the deploy-time env. That mismatch in the dependency list crash-loops the container
# ("Function has N dependencies but container got N+1 object ids"). So the secret set
# must be identical locally and remotely — hence no conditional.
web_secrets = [hf_secret, offline_secret, modal.Secret.from_name("ai-detector")]


@app.function(volumes={"/weights": weights}, secrets=[hf_secret], timeout=1800)
def download_weights():
    """Run once. Pulls the base + adapter into the Volume so cold starts never
    re-download them."""
    import os

    from huggingface_hub import snapshot_download

    for repo in ("meta-llama/Llama-3.2-3B", "pangram/editlens_Llama-3.2-3B"):
        print(f"downloading {repo} ...")
        snapshot_download(repo, token=os.environ.get("HF_TOKEN"))
    weights.commit()
    print("weights committed to Volume.")


@app.function(
    gpu=GPU,  # L4 24GB — ample for a 3B model; the cheapest GPU that fits comfortably.
    volumes={"/weights": weights},
    secrets=web_secrets,  # HF (+ offline) always; bearer only when DETECTOR_USE_AUTH=1
    scaledown_window=SCALEDOWN_WINDOW,  # cost/speed tuner (env DETECTOR_SCALEDOWN_WINDOW)
    min_containers=MIN_CONTAINERS,      # 0 = scale-to-zero (cheap) | 1 = always-warm (env DETECTOR_MIN_CONTAINERS)
    timeout=120,
)
@modal.concurrent(max_inputs=100)  # many requests share one container -> the in-process batcher batches them
@modal.asgi_app()
def web():
    import sys

    sys.path.insert(0, "/root")
    from app import app as fastapi_app  # existing FastAPI + micro-batcher, unchanged

    return fastapi_app
