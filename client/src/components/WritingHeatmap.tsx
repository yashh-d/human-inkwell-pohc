/**
 * WritingHeatmap — a GitHub-style contribution grid for a creator's published work.
 *
 * Receipts, not scores: this is descriptive only. Each square is one day; its
 * intensity is how much *active writing* landed that day (summed from the day's
 * pieces, falling back to piece count when a piece has no timing). Cyan ramp to
 * match the brand. Streak numbers are honest facts ("days you published"), never
 * a graded target.
 */
import { useMemo } from 'react';
import { CreatorFeedPost } from '../creatorSupabase';

const WEEKS = 53;             // ~1 year of columns
const CELL = 11;              // square size (px)
const GAP = 3;                // gap between squares (px)
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Local YYYY-MM-DD key (avoids UTC off-by-one at day boundaries). */
function dayKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

type Day = { key: string; date: Date; seconds: number; pieces: number; inRange: boolean };

/** Intensity bucket 0–4 from a day's active-writing seconds (piece presence = at least 1). */
function level(day: Day): number {
  if (day.pieces === 0) return 0;
  const mins = day.seconds / 60;
  if (day.seconds === 0) return 1;   // published, but no timing captured
  if (mins < 20) return 1;
  if (mins < 60) return 2;
  if (mins < 150) return 3;
  return 4;
}

const FILL = [
  'var(--hi-surface-muted, #f1f4f8)',
  'rgba(0,180,216,0.28)',
  'rgba(0,180,216,0.5)',
  'rgba(0,180,216,0.74)',
  'var(--hi-cyan, #00b4d8)',
];

export default function WritingHeatmap({ posts }: { posts: CreatorFeedPost[] }) {
  const { columns, monthLabels, current, longest, activeDays } = useMemo(() => {
    // Aggregate posts by local day.
    const byDay = new Map<string, { seconds: number; pieces: number }>();
    for (const p of posts) {
      if (!p.published_at) continue;
      const d = new Date(p.published_at);
      if (isNaN(d.getTime())) continue;
      const k = dayKey(d);
      const cur = byDay.get(k) || { seconds: 0, pieces: 0 };
      cur.seconds += Number(p.active_seconds || 0);
      cur.pieces += 1;
      byDay.set(k, cur);
    }

    // Grid ends today; back up to the most recent Sunday so weeks are columns.
    const end = new Date();
    end.setHours(0, 0, 0, 0);
    const start = new Date(end);
    start.setDate(start.getDate() - (WEEKS * 7 - 1));
    start.setDate(start.getDate() - start.getDay()); // rewind to Sunday

    const cols: Day[][] = [];
    const labels: Array<{ col: number; text: string }> = [];
    const cursor = new Date(start);
    let lastMonth = -1;
    for (let w = 0; w < WEEKS; w++) {
      const week: Day[] = [];
      for (let dow = 0; dow < 7; dow++) {
        const date = new Date(cursor);
        const key = dayKey(date);
        const agg = byDay.get(key);
        const inRange = date <= end;
        week.push({ key, date, seconds: agg?.seconds || 0, pieces: agg?.pieces || 0, inRange });
        if (dow === 0 && date.getMonth() !== lastMonth && inRange) {
          labels.push({ col: w, text: MONTHS[date.getMonth()] });
          lastMonth = date.getMonth();
        }
        cursor.setDate(cursor.getDate() + 1);
      }
      cols.push(week);
    }

    // Streaks over days with ≥1 published piece.
    const written = new Set(Array.from(byDay.keys()));
    let longestRun = 0, run = 0;
    const first = new Date(start);
    for (const d = new Date(first); d <= end; d.setDate(d.getDate() + 1)) {
      if (written.has(dayKey(d))) { run += 1; longestRun = Math.max(longestRun, run); }
      else run = 0;
    }
    // Current streak counts back from today (today needn't have a piece yet).
    let currentRun = 0;
    const walk = new Date(end);
    if (!written.has(dayKey(walk))) walk.setDate(walk.getDate() - 1);
    while (written.has(dayKey(walk))) { currentRun += 1; walk.setDate(walk.getDate() - 1); }

    return {
      columns: cols,
      monthLabels: labels,
      current: currentRun,
      longest: longestRun,
      activeDays: written.size,
    };
  }, [posts]);

  return (
    <div style={S.wrap}>
      <div style={S.top}>
        <span style={S.heading}>Writing activity</span>
        <div style={S.streaks}>
          <span><b style={S.b}>{current}</b> day streak</span>
          <span style={S.dot}>·</span>
          <span><b style={S.b}>{longest}</b> longest</span>
          <span style={S.dot}>·</span>
          <span><b style={S.b}>{activeDays}</b> days written</span>
        </div>
      </div>

      <div style={S.scroll}>
        <div>
          <div style={{ ...S.monthRow, height: 14 }}>
            {monthLabels.map((m) => (
              <span key={`${m.col}-${m.text}`} style={{ ...S.month, left: m.col * (CELL + GAP) }}>{m.text}</span>
            ))}
          </div>
          <div style={S.grid}>
            {columns.map((week, wi) => (
              <div key={wi} style={S.col}>
                {week.map((day) => {
                  if (!day.inRange) return <div key={day.key} style={{ ...S.cell, background: 'transparent' }} />;
                  const lv = level(day);
                  const label = day.pieces
                    ? `${day.pieces} piece${day.pieces > 1 ? 's' : ''}${day.seconds ? ` · ${Math.round(day.seconds / 60)} min active` : ''} on ${day.date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}`
                    : `No writing on ${day.date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}`;
                  return <div key={day.key} title={label} style={{ ...S.cell, background: FILL[lv], border: lv === 0 ? '1px solid var(--hi-border, #e6e9ee)' : '1px solid transparent' }} />;
                })}
              </div>
            ))}
          </div>
        </div>
      </div>

      <div style={S.legend}>
        <span style={S.less}>Less</span>
        {FILL.map((f, i) => (
          <div key={i} style={{ ...S.cell, background: f, border: i === 0 ? '1px solid var(--hi-border, #e6e9ee)' : '1px solid transparent' }} />
        ))}
        <span style={S.less}>More</span>
      </div>
    </div>
  );
}

const S: Record<string, React.CSSProperties> = {
  wrap: { border: '1px solid var(--hi-border, #e6e9ee)', borderRadius: 12, padding: '14px 16px', background: 'var(--hi-surface, #fff)', margin: '0 0 18px' },
  top: { display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12, flexWrap: 'wrap', marginBottom: 10 },
  heading: { fontSize: 13, fontWeight: 700, color: 'var(--hi-text, #0a0a0a)' },
  streaks: { display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--hi-text-muted, #64748b)' },
  b: { color: 'var(--hi-cyan-ink, #075985)', fontVariantNumeric: 'tabular-nums' },
  dot: { opacity: 0.5 },
  scroll: { overflowX: 'auto', paddingBottom: 4 },
  monthRow: { position: 'relative', width: WEEKS * (CELL + GAP) },
  month: { position: 'absolute', top: 0, fontSize: 9.5, color: 'var(--hi-text-muted, #64748b)' },
  grid: { display: 'flex', gap: GAP, width: 'max-content' },
  col: { display: 'flex', flexDirection: 'column', gap: GAP },
  cell: { width: CELL, height: CELL, borderRadius: 2.5, boxSizing: 'border-box', flexShrink: 0 },
  legend: { display: 'flex', alignItems: 'center', gap: 4, justifyContent: 'flex-end', marginTop: 8 },
  less: { fontSize: 9.5, color: 'var(--hi-text-muted, #64748b)', margin: '0 3px' },
};
