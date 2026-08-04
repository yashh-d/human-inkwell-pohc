/**
 * activeTime — the single, honest definition of "time invested" in a piece.
 *
 * We never trust a wall-clock (start → now): a tab left open in the background
 * would inflate it. Instead we reconstruct time from ACTIVITY events — every
 * keystroke, paste, mouse-move and scroll while the writer is actually at the
 * document. Between two consecutive events there's a gap; we credit that gap as
 * working time, but:
 *
 *   • any portion of the gap where the tab was HIDDEN counts as zero (you were
 *     in another app — not writing), and
 *   • a single gap is capped at ACTIVE_CAP_MS, so a long pause with the doc still
 *     on screen (stepped away, left it open) is bounded rather than counted in
 *     full or dropped to nothing.
 *
 * The result credits reading, thinking and editing at the doc, while excluding
 * genuine away-time. The extension mirrors this exact algorithm so a Google Docs
 * proof and an in-app proof mean the same thing.
 */

/** A stretch of time the page spent hidden. `end` is null while still hidden. */
export type HiddenInterval = { start: number; end: number | null };

/** Cap for a single visible pause: 3 minutes. Reading/thinking counts up to here. */
export const ACTIVE_CAP_MS = 180_000;

/** Total hidden duration, treating a still-open interval as ending `now`. */
export function hiddenMsTotal(hidden: HiddenInterval[], now: number = Date.now()): number {
  let total = 0;
  for (const iv of hidden) {
    const end = iv.end == null ? now : iv.end;
    if (end > iv.start) total += end - iv.start;
  }
  return total;
}

/**
 * Active writing time (ms) from sorted-or-unsorted activity timestamps, the
 * hidden intervals to exclude, and the per-gap cap.
 */
export function computeActiveMs(
  eventTimes: number[],
  hidden: HiddenInterval[] = [],
  capMs: number = ACTIVE_CAP_MS,
  now: number = Date.now(),
): number {
  const ev = eventTimes.filter((t) => Number.isFinite(t)).sort((a, b) => a - b);
  if (ev.length < 2) return 0;

  // Resolve any open hidden interval to `now` so away-time is excluded even when
  // the tab is currently hidden at compute time.
  const iv = hidden.map((h) => ({ start: h.start, end: h.end == null ? now : h.end }));
  const hiddenOverlap = (a: number, b: number): number => {
    let h = 0;
    for (const s of iv) {
      const lo = Math.max(a, s.start);
      const hi = Math.min(b, s.end);
      if (hi > lo) h += hi - lo;
    }
    return h;
  };

  let active = 0;
  for (let i = 1; i < ev.length; i++) {
    const a = ev[i - 1];
    const b = ev[i];
    const gap = b - a;
    if (gap <= 0) continue;
    const visible = Math.max(0, gap - hiddenOverlap(a, b));
    active += Math.min(visible, capMs);
  }
  return active;
}
