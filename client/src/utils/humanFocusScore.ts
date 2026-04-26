const POINTS_OFF_PER_TAB_LEAVE = 10;

/**
 * 0–100 "human focus" score: only the number of times the page was hidden
 * (tab, window, lock) during the session. Staying in the field to type is
 * the baseline; each leave takes points off. Other typing metrics are not
 * part of this score.
 */
export function humanFocusScoreFromTabAwayCount(tabAwayCount: number): number {
  const n = Math.max(0, tabAwayCount);
  return Math.max(0, 100 - n * POINTS_OFF_PER_TAB_LEAVE);
}

export const HUMAN_FOCUS_SCORE_POINTS_OFF_PER_LEAVE = POINTS_OFF_PER_TAB_LEAVE;
