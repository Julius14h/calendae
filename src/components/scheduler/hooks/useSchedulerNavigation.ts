import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { shiftAnchorDate, visibleRangeForView } from '../utils/dateMath';
import type { DateRange, SchedulerView } from '../Scheduler.types';

export interface UseSchedulerNavigationOptions {
  initialView?: SchedulerView;
  initialDate?: Date;
  weekStartsOn: 0 | 1;
  onViewChange?: (view: SchedulerView) => void;
  onDateChange?: (range: DateRange) => void;
}

/**
 * Owns the scheduler's current view + anchor date and derives the visible
 * date range from them. Shared by the Toolbar (prev/next/today/view buttons)
 * and the imperative ref API (`gotoToday`/`gotoDate`), so both paths behave
 * identically and fire the same `onViewChange`/`onDateChange` callbacks.
 */
export function useSchedulerNavigation({
  initialView,
  initialDate,
  weekStartsOn,
  onViewChange,
  onDateChange,
}: UseSchedulerNavigationOptions) {
  const [view, setViewState] = useState<SchedulerView>(initialView ?? 'week');
  const [anchorDate, setAnchorDate] = useState<Date>(initialDate ?? new Date());

  const range = useMemo(
    () => visibleRangeForView(view, anchorDate, weekStartsOn),
    [view, anchorDate, weekStartsOn],
  );

  const isFirstRangeEffect = useRef(true);
  useEffect(() => {
    if (isFirstRangeEffect.current) {
      isFirstRangeEffect.current = false;
      return;
    }
    onDateChange?.(range);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [range.start.getTime(), range.end.getTime()]);

  const isFirstViewEffect = useRef(true);
  useEffect(() => {
    if (isFirstViewEffect.current) {
      isFirstViewEffect.current = false;
      return;
    }
    onViewChange?.(view);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view]);

  const setView = useCallback((next: SchedulerView) => setViewState(next), []);
  const gotoToday = useCallback(() => setAnchorDate(new Date()), []);
  const gotoDate = useCallback((date: Date) => setAnchorDate(date), []);
  const gotoPrev = useCallback(
    () => setAnchorDate((current) => shiftAnchorDate(view, current, -1)),
    [view],
  );
  const gotoNext = useCallback(
    () => setAnchorDate((current) => shiftAnchorDate(view, current, 1)),
    [view],
  );

  return { view, anchorDate, range, setView, gotoToday, gotoDate, gotoPrev, gotoNext };
}
