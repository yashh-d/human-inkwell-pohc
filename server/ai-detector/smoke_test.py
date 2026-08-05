"""Quick sanity check for the detector — scores one clearly-human and one
clearly-AI text and prints the 0..1 scores. Run AFTER the model loads.

  # in-process (no server needed):
  python smoke_test.py

  # or against a running worker:
  python smoke_test.py --url http://localhost:8000
"""
import argparse
import json
import sys

HUMAN = (
    "ok so i finally got around to fixing the back fence this weekend and honestly "
    "what a pain. half the nails were rusted through and my drill died twice. ended "
    "up borrowing my neighbor's, the guy never shuts up but he did save my afternoon. "
    "anyway it's standing now, mostly straight, we'll see if it survives the next storm."
)
AI = (
    "Repairing a fence is a rewarding weekend project that enhances both the security "
    "and aesthetic appeal of your property. Begin by assessing the damage, then gather "
    "the necessary tools and materials. With careful planning and attention to detail, "
    "you can ensure a durable and long-lasting result that will provide value for years."
)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--url", default=None, help="Base URL of a running worker; omit to run in-process")
    args = ap.parse_args()

    if args.url:
        import urllib.request
        def score(text):
            req = urllib.request.Request(
                args.url.rstrip("/") + "/detect",
                data=json.dumps({"text": text}).encode(),
                headers={"Content-Type": "application/json"},
            )
            with urllib.request.urlopen(req, timeout=120) as r:
                return json.loads(r.read())["ai"]
    else:
        from backends.pangram import PangramDetector
        det = PangramDetector()
        score = det.score

    h, a = score(HUMAN), score(AI)
    print(f"human-looking text : ai={h:.3f}  (expect low, near 0)")
    print(f"AI-looking text    : ai={a:.3f}  (expect high, near 1)")
    ok = h < 0.5 < a
    print("PASS" if ok else "CHECK: ordering unexpected — verify model/threshold")
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
