import { useRef, useCallback, useState } from 'react';
import { HiddenInterval, hiddenMsTotal } from '../lib/activeTime';

interface KeystrokeEvent {
  key: string;
  eventType: 'keydown' | 'keyup';
  timestamp: number;
}

interface UseKeystrokeCaptureReturn {
  startCapture: (target: HTMLElement) => void;
  stopCapture: () => void;
  getRawKeystrokeData: () => KeystrokeEvent[];
  /** Times the page became hidden (tab/window switch, minimize, etc.) during the last capture session. */
  getTabAwayCount: () => number;
  /** Total ms the page spent hidden while capturing — so time-invested can exclude it. */
  getHiddenMs: () => number;
  /** Hidden stretches (start/end ms) so active-time can subtract them per-gap. */
  getHiddenIntervals: () => HiddenInterval[];
  /** Coarse activity heartbeats (mouse-move / scroll / click) — reading & editing at the doc. */
  getActivityTimestamps: () => number[];
  resetCapture: () => void;
  isCapturing: boolean;
}

// Record at most one non-typing activity heartbeat per second — a mouse-move
// fires dozens of events, but for active-time we only need to know the writer
// was present in that window.
const ACTIVITY_THROTTLE_MS = 1000;

export const useKeystrokeCapture = (): UseKeystrokeCaptureReturn => {
  const keystrokeDataRef = useRef<KeystrokeEvent[]>([]);
  const tabAwayCountRef = useRef(0);
  const hiddenIntervalsRef = useRef<HiddenInterval[]>([]);
  const activityTsRef = useRef<number[]>([]);
  const lastActivityAtRef = useRef(0);
  const [isCapturing, setIsCapturing] = useState(false);
  const targetElementRef = useRef<HTMLElement | null>(null);
  const isCapturingRef = useRef(false);

  // Track hidden stretches as intervals: open one when the tab hides, close it
  // when it returns. Active-time subtracts any overlap of these with a pause, so
  // a tab merely left open in the background never inflates the clock.
  const handleVisibilityChange = useCallback(() => {
    if (!isCapturingRef.current) return;
    const iv = hiddenIntervalsRef.current;
    if (document.hidden) {
      const open = iv.length > 0 && iv[iv.length - 1].end == null;
      if (!open) iv.push({ start: Date.now(), end: null });
      tabAwayCountRef.current += 1;
    } else {
      const last = iv[iv.length - 1];
      if (last && last.end == null) last.end = Date.now();
    }
  }, []);

  // A single coarse heartbeat for any non-typing presence at the doc (mouse,
  // scroll, click). Throttled so we don't store thousands of mousemove events.
  const noteActivity = useCallback(() => {
    if (!isCapturingRef.current) return;
    const now = Date.now();
    if (now - lastActivityAtRef.current < ACTIVITY_THROTTLE_MS) return;
    lastActivityAtRef.current = now;
    activityTsRef.current.push(now);
  }, []);

  const handleKeyDown = useCallback((event: KeyboardEvent) => {
    if (!isCapturingRef.current) return;
    keystrokeDataRef.current.push({
      key: event.key,
      eventType: 'keydown',
      timestamp: Date.now(),
    });
  }, []);

  const handleKeyUp = useCallback((event: KeyboardEvent) => {
    if (!isCapturingRef.current) return;
    keystrokeDataRef.current.push({
      key: event.key,
      eventType: 'keyup',
      timestamp: Date.now(),
    });
  }, []);

  const detachActivity = useCallback(() => {
    document.removeEventListener('mousemove', noteActivity);
    document.removeEventListener('wheel', noteActivity);
    document.removeEventListener('scroll', noteActivity, true);
    document.removeEventListener('pointerdown', noteActivity);
  }, [noteActivity]);

  const stopCapture = useCallback(() => {
    if (!isCapturingRef.current || !targetElementRef.current) return;

    isCapturingRef.current = false;
    setIsCapturing(false);

    // Close any in-progress hidden stretch (stopped while the tab was hidden).
    const iv = hiddenIntervalsRef.current;
    const last = iv[iv.length - 1];
    if (last && last.end == null) last.end = Date.now();

    document.removeEventListener('visibilitychange', handleVisibilityChange);
    detachActivity();
    targetElementRef.current.removeEventListener('keydown', handleKeyDown);
    targetElementRef.current.removeEventListener('keyup', handleKeyUp);

    targetElementRef.current = null;
  }, [handleKeyDown, handleKeyUp, handleVisibilityChange, detachActivity]);

  const startCapture = useCallback((target: HTMLElement) => {
    // Stop current capture if already capturing
    if (isCapturingRef.current && targetElementRef.current) {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      detachActivity();
      targetElementRef.current.removeEventListener('keydown', handleKeyDown);
      targetElementRef.current.removeEventListener('keyup', handleKeyUp);
    }

    targetElementRef.current = target;
    isCapturingRef.current = true;
    setIsCapturing(true);

    // Clear previous data
    keystrokeDataRef.current = [];
    tabAwayCountRef.current = 0;
    activityTsRef.current = [];
    lastActivityAtRef.current = 0;
    hiddenIntervalsRef.current = document.hidden ? [{ start: Date.now(), end: null }] : [];

    // Add event listeners
    target.addEventListener('keydown', handleKeyDown);
    target.addEventListener('keyup', handleKeyUp);
    document.addEventListener('visibilitychange', handleVisibilityChange);
    document.addEventListener('mousemove', noteActivity);
    document.addEventListener('wheel', noteActivity, { passive: true });
    document.addEventListener('scroll', noteActivity, true);
    document.addEventListener('pointerdown', noteActivity);
  }, [handleKeyDown, handleKeyUp, handleVisibilityChange, noteActivity, detachActivity]);

  const getRawKeystrokeData = useCallback(() => [...keystrokeDataRef.current], []);

  const getTabAwayCount = useCallback(() => tabAwayCountRef.current, []);

  const getHiddenIntervals = useCallback(() => hiddenIntervalsRef.current.map((h) => ({ ...h })), []);

  const getActivityTimestamps = useCallback(() => [...activityTsRef.current], []);

  const getHiddenMs = useCallback(() => hiddenMsTotal(hiddenIntervalsRef.current), []);

  const resetCapture = useCallback(() => {
    keystrokeDataRef.current = [];
    tabAwayCountRef.current = 0;
    activityTsRef.current = [];
    lastActivityAtRef.current = 0;
    hiddenIntervalsRef.current = [];
  }, []);

  return {
    startCapture,
    stopCapture,
    getRawKeystrokeData,
    getTabAwayCount,
    getHiddenMs,
    getHiddenIntervals,
    getActivityTimestamps,
    resetCapture,
    isCapturing,
  };
};
