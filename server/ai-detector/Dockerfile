# GPU image for the AI-detector worker. Runs as-is on a Hugging Face Docker Space
# (GPU hardware) or any autoscaling GPU host (Modal / Baseten / RunPod / a GPU VM).
# CPU works for local dev but is slow for the 3B model.
FROM pytorch/pytorch:2.3.1-cuda12.1-cudnn8-runtime

# Install deps as root (system site-packages), then drop to a non-root user for
# runtime — which is also what Hugging Face Spaces expect.
WORKDIR /app
COPY requirements.txt .
# torch ships in the base image. bitsandbytes is REQUIRED on CUDA: the Pangram
# backend loads the adapter in 4-bit nf4 (as trained) and transformers errors
# without it. It's CUDA-only, so it lives here (not in requirements.txt, which is
# also used for CPU/macOS dev where bitsandbytes must NOT be installed).
RUN pip install --no-cache-dir -r requirements.txt \
    && pip install --no-cache-dir "bitsandbytes>=0.43"

# Non-root user (HF Spaces run as uid 1000) with a writable HF model cache so
# weights download to a directory the runtime user owns.
RUN useradd -m -u 1000 user
COPY --chown=user:user . /app

USER user
ENV HOME=/home/user \
    HF_HOME=/home/user/.cache/huggingface \
    PORT=8000
EXPOSE 8000
CMD ["sh", "-c", "uvicorn app:app --host 0.0.0.0 --port ${PORT}"]
