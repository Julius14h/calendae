import { useEffect, useState } from 'react';
import { isSameDay } from './utils/dateMath';
import { dateToX, type TimelineGeometry } from './utils/timeGeometry';
import styles from './TimelineView.module.css';

export interface CurrentTimeIndicatorProps {
  geometry: TimelineGeometry;
  height: number;
}

const UPDATE_INTERVAL_MS = 60_000;

/**
 * A vertical "now" line across the timeline canvas, refreshed once a minute.
 * Browsers throttle (or fully suspend) `setInterval` in backgrounded tabs, so
 * a bare interval alone can leave this showing a stale time — potentially
 * off by however long the tab sat inactive — right when the user switches
 * back to look at it. Also refreshing on `visibilitychange` snaps it back to
 * the true current time the moment the tab regains focus.
 */
export function CurrentTimeIndicator({ geometry, height }: CurrentTimeIndicatorProps) {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), UPDATE_INTERVAL_MS);
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') setNow(new Date());
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      window.clearInterval(id);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, []);

  const visible = geometry.days.some((day) => isSameDay(day, now));
  if (!visible) return null;

  const withinBusinessHours =
    now.getHours() >= geometry.dayStartHour && now.getHours() < geometry.dayEndHour;
  if (!withinBusinessHours) return null;

  const x = dateToX(now, geometry);

  return <div className={styles.nowLine} style={{ left: x, height }} />;
}
