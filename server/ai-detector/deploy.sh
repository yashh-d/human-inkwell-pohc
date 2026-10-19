#!/usr/bin/env bash
# One-command on/off + warm/cold control for the Modal AI-detector.
#
#   ./deploy.sh weights          # ONE TIME: preload the 6GB weights into a Volume
#   ./deploy.sh cold             # turn ON, scale-to-zero (cheap, pay-by-seconds)
#   ./deploy.sh warm             # turn ON, one always-warm GPU (no cold starts)
#   ./deploy.sh off              # turn OFF completely (stops all containers/billing)
#   ./deploy.sh status           # what's deployed right now
#   ./deploy.sh speed <url> [t]  # measure real latency against a deployed URL
#
# `cold` vs `warm` is the whole "test both" experiment: deploy one, run `speed`,
# then deploy the other and run `speed` again. `off` is the true kill switch — with
# scale-to-zero you pay ~nothing idle anyway, but `off` guarantees zero.
set -euo pipefail
cd "$(dirname "$0")"
APP=human-ink-ai-detector
# Use the venv's modern Modal + Python (bare `modal` on PATH may be an old build).
MODAL="${MODAL:-.venv/bin/modal}"; [ -x "$MODAL" ] || MODAL=modal
PY="${PY:-.venv/bin/python}"; [ -x "$PY" ] || PY=python3
cmd="${1:-help}"

case "$cmd" in
  weights)
    "$MODAL" run modal_app.py::download_weights ;;
  cold|up|on)
    DETECTOR_MIN_CONTAINERS=0 DETECTOR_SCALEDOWN_WINDOW="${SCALEDOWN:-60}" "$MODAL" deploy modal_app.py ;;
  warm)
    # GUARDED: one L4 billed 24/7 is ~$0.80/hr ≈ $575/mo and will burn a credit
    # budget in days. This is how the workspace got disabled once. Require an
    # explicit opt-in so it can't be run by muscle memory.
    if [ "${I_UNDERSTAND_THIS_BILLS_24_7:-}" != "yes" ]; then
      echo "REFUSING: 'warm' keeps a GPU on 24/7 (~\$0.80/hr, ~\$575/mo)." >&2
      echo "Use './deploy.sh cold' (scale-to-zero, ~\$0 idle) for normal use." >&2
      echo "To really run warm:  I_UNDERSTAND_THIS_BILLS_24_7=yes ./deploy.sh warm" >&2
      echo "…and run './deploy.sh cold' or './deploy.sh off' when the demo is over." >&2
      exit 1
    fi
    DETECTOR_MIN_CONTAINERS=1 "$MODAL" deploy modal_app.py ;;
  off|down|stop)
    "$MODAL" app stop "$APP" ;;
  status)
    "$MODAL" app list ;;
  speed)
    url="${2:?usage: ./deploy.sh speed <url> [token]}"
    token="${3:-}"
    # Small burst: p50/p95/max — the max captures a cold-start hit if one happens.
    "$PY" loadtest.py --url "$url" --concurrency 20 --total 60 ${token:+--token "$token"} ;;
  *)
    grep -E '^#( |$)' "$0" | sed 's/^# \{0,1\}//' ;;
esac
