import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DAY_MS, formatTimeOfDay, formatTimeRange, isSameDay, monthGridDays } from './utils/dateMath';
import { computeOverlapLayout } from './utils/overlapLayout';
import { findConflicts } from './utils/conflict';
import { initialsFor } from './utils/initials';
import { colorForInstructor } from './utils/instructorColor';
import { usePointerDrag } from './hooks/usePointerDrag';
import type { EventRenderContext, SchedulerEvent, SchedulerProps } from './Scheduler.types';
import styles from './MonthView.module.css';

const CLICK_MOVE_THRESHOLD_PX = 3;
const MAX_VISIBLE_LANES = 3;
// Collapsed rows show a compact single line (start time + title); once a
// week is expanded via "+N more", every bar in it switches to two lines
// (title + full time range) and needs the taller lane to fit both.
const BAR_HEIGHT_COLLAPSED = 35; // 22 * 1.6, rounded
const BAR_HEIGHT_EXPANDED = 44;
const DAY_NUMBER_HEIGHT = 30;
const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export interface MonthViewProps {
  events: SchedulerEvent[];
  eventColors: Map<string, string>;
  anchorDate: Date;
  weekStartsOn: 0 | 1;
  /** The event whose details drawer is open (double-clicked) — the only thing that gets the "selected" highlight now, see Scheduler.tsx. */
  selectedEventId: string | null;
  /** Class types / instructors unchecked in the drawer — hidden from this grid only. */
  hiddenClassTypes: Set<string>;
  hiddenInstructorIds: Set<number>;
  /** Drag-to-move-to-a-different-day only fires at all when true — same gating convention as Day/Week view. */
  editable: boolean;
  /** Called directly when a drag lands on a conflict-free day (room and instructor both free) — same signature/semantics as Day/Week's own onEventMove, since by the time this fires there's nothing left to resolve. */
  onEventMove?: SchedulerProps['onEventMove'];
  /** Called instead of onEventMove when the drop would conflict (room booked, or the instructor already booked elsewhere) — Scheduler.tsx opens the resolution modal in response rather than applying anything yet. */
  onEventMoveConflict?: (event: SchedulerEvent, newStart: Date, newEnd: Date) => void;
  renderEvent?: SchedulerProps['renderEvent'];
  onEventClick?: SchedulerProps['onEventClick'];
  onEventDoubleClick?: SchedulerProps['onEventDoubleClick'];
  onDateClick?: SchedulerProps['onDateClick'];
  /** Hovering a day cell reveals a "View day" button — this fires on click, opening a full Day-view grid for that date in a modal (see Scheduler.tsx's MonthDayPreviewModal). */
  onOpenDayPreview?: (day: Date) => void;
}

interface WeekBar {
  event: SchedulerEvent;
  colStart: number;
  colSpan: number;
  lane: number;
}

/** Google-Calendar-style month grid: 6 weeks x 7 days, with multi-day events as continuous bars. */
export function MonthView({
  events,
  eventColors,
  anchorDate,
  weekStartsOn,
  selectedEventId,
  hiddenClassTypes,
  hiddenInstructorIds,
  editable,
  onEventMove,
  onEventMoveConflict,
  renderEvent,
  onEventClick,
  onEventDoubleClick,
  onDateClick,
  onOpenDayPreview,
}: MonthViewProps) {
  const gridDays = useMemo(() => monthGridDays(anchorDate, weekStartsOn), [anchorDate, weekStartsOn]);
  const weeks = useMemo(() => {
    const result: Date[][] = [];
    for (let i = 0; i < gridDays.length; i += 7) result.push(gridDays.slice(i, i + 7));
    return result;
  }, [gridDays]);

  const [expandedWeeks, setExpandedWeeks] = useState<Set<number>>(new Set());
  const today = new Date();

  // Hidden here only — doesn't affect anything computed from the full `events`
  // elsewhere (there's nothing else in Month view that needs the true picture).
  const visibleEvents = useMemo(
    () => events.filter((e) => !(e.type && hiddenClassTypes.has(e.type)) && !hiddenInstructorIds.has(e.instructorId)),
    [events, hiddenClassTypes, hiddenInstructorIds],
  );

  const weekBarsAndHidden = useMemo(
    () => weeks.map((weekDays) => computeWeekLayout(weekDays, visibleEvents)),
    [weeks, visibleEvents],
  );

  const toggleExpanded = (weekIndex: number) => {
    setExpandedWeeks((current) => {
      const next = new Set(current);
      if (next.has(weekIndex)) next.delete(weekIndex);
      else next.add(weekIndex);
      return next;
    });
  };

  const weeksContainerRef = useRef<HTMLDivElement>(null);
  const weekRowRefs = useRef<(HTMLDivElement | null)[]>([]);
  const draggingEventRef = useRef<SchedulerEvent | null>(null);
  const originRef = useRef({ clientX: 0, clientY: 0 });
  const movedRef = useRef(false);
  const suppressClickRef = useRef(false);
  const [draggingEventId, setDraggingEventId] = useState<string | null>(null);
  // Set alongside draggingEventId, not read from draggingEventRef during
  // render — a ref's .current is only safe to read in event handlers/effects.
  const [draggingEventTitle, setDraggingEventTitle] = useState<string | null>(null);
  const [hoverDate, setHoverDate] = useState<Date | null>(null);
  // Raw viewport position while dragging — drives the floating ghost chip
  // below, which is the only thing that actually visually follows the
  // cursor (the original bar just dims in place; a month-view move can jump
  // to a totally different week row with no natural "same row" position to
  // preview it at, unlike Day/Week's horizontal-only drag).
  const [dragPointerPos, setDragPointerPos] = useState<{ x: number; y: number } | null>(null);
  // Where within the bar it was actually grabbed (captured from the bar's own
  // rect at pointerdown) — the ghost is positioned at cursor-minus-this-offset
  // so the exact point grabbed stays glued to the cursor, same as EventBlock's
  // own move-drag, rather than the ghost's fixed top-left always trailing a
  // constant distance from the cursor regardless of grab point.
  const [dragGrabOffset, setDragGrabOffset] = useState({ x: 0, y: 0 });
  // Floating tooltip for the instructor-initials avatar, positioned via a
  // measured rect rather than CSS :hover — .eventBar clips overflow (for
  // title truncation) and .weeksContainer scrolls, so a plain CSS tooltip
  // anchored inside the bar would get clipped; this renders as a page-level
  // sibling instead, same approach as the drag ghost chip below.
  const [hoveredInstructor, setHoveredInstructor] = useState<{ name: string; x: number; y: number } | null>(null);
  // Which day's "View day" button should be visible — driven by JS, not a
  // plain CSS :hover on .dayCell, because event bars render in .barsLayer, a
  // sibling that's painted *on top of* the day cells starting at
  // DAY_NUMBER_HEIGHT. Hovering a bar never actually hovers the .dayCell
  // underneath it (the bar intercepts the pointer), so without this, hovering
  // an event wouldn't reveal that day's button at all.
  const [viewDayHoverDate, setViewDayHoverDate] = useState<Date | null>(null);

  // Mirrors of frequently-changing props, kept fresh every render (via effect,
  // not a direct write during render — refs shouldn't be mutated while
  // rendering), so the drag callbacks below can read "the latest value"
  // without needing to be recreated themselves — see the stability comment
  // on `handleDragMove` for why that recreation is the actual bug being avoided.
  const eventsRef = useRef(events);
  const onEventMoveRef = useRef(onEventMove);
  const onEventMoveConflictRef = useRef(onEventMoveConflict);
  useEffect(() => {
    eventsRef.current = events;
    onEventMoveRef.current = onEventMove;
    onEventMoveConflictRef.current = onEventMoveConflict;
  });

  // Which (week, day-of-week) column a viewport point falls into. Week rows
  // here are plain, non-virtualized flow children (unlike TimelineView's
  // absolutely-positioned, virtualized rows), so a direct rect scan is exact
  // and cheap — no need for utils/rowLayout.ts's cumulative-offset math.
  // `weeks` is a safe dependency (not a ref) — it's a useMemo that only
  // changes when anchorDate/weekStartsOn do, never mid-drag.
  const dateAtPoint = useCallback((clientX: number, clientY: number): Date | null => {
    const rects = weekRowRefs.current.map((el) => el?.getBoundingClientRect() ?? null);
    let weekIndex = rects.findIndex((r) => r && clientY >= r.top && clientY < r.bottom);
    if (weekIndex === -1) {
      const firstRect = rects.find((r): r is DOMRect => r !== null);
      if (!firstRect) return null;
      weekIndex = clientY < firstRect.top ? 0 : rects.length - 1;
    }
    const rect = rects[weekIndex];
    if (!rect) return null;
    const dayIndex = Math.min(6, Math.max(0, Math.floor(((clientX - rect.left) / rect.width) * 7)));
    return weeks[weekIndex]?.[dayIndex] ?? null;
  }, [weeks]);

  const handleDrop = useCallback((event: SchedulerEvent, targetDate: Date) => {
    if (isSameDay(targetDate, event.start)) return; // dropped on its own day — no-op, not a move
    const durationMs = event.end.getTime() - event.start.getTime();
    // Calendar-field construction, not DAY_MS arithmetic — avoids silently
    // shifting wall-clock time by an hour across a DST boundary.
    const newStart = new Date(
      targetDate.getFullYear(), targetDate.getMonth(), targetDate.getDate(),
      event.start.getHours(), event.start.getMinutes(), event.start.getSeconds(), event.start.getMilliseconds(),
    );
    const newEnd = new Date(newStart.getTime() + durationMs);

    // Always the full, unfiltered `events` — never `visibleEvents`, which is
    // display-only (hidden class types/instructors still really occupy their
    // room/instructor).
    const { roomConflict, instructorConflict } = findConflicts(eventsRef.current, {
      resourceId: event.resourceId,
      instructorId: event.instructorId,
      start: newStart,
      end: newEnd,
      excludeEventId: event.id,
    });

    if (!roomConflict && !instructorConflict) onEventMoveRef.current?.(event, event.resourceId, newStart, newEnd);
    else onEventMoveConflictRef.current?.(event, newStart, newEnd);
  }, []);

  // Stable (empty/minimal deps) on purpose: usePointerDrag attaches its
  // window-level pointermove/pointerup listeners exactly once, at the
  // instant pointerdown fires. If onStart/onMove/onEnd were recreated on
  // every render — which they would be as plain inline closures, since
  // onMove's own setHoverDate/setDragPointerPos calls re-render this
  // component on every single pointer move during a drag — the *listener
  // that's actually attached* stays bound to the very first render's
  // closure, but its own cleanup (removeEventListener, keyed off a ref that
  // always points at the *latest* closure) ends up trying to remove a
  // different function than the one that was ever added. That removal
  // silently fails, leaking a stale listener on every single drag. Because
  // this hook instance here is shared across every event bar in the whole
  // month grid (not one-per-event like EventBlock's own usePointerDrag),
  // that leak doesn't stay contained to one event — it corrupts every
  // subsequent drag attempt in the session, since they all share the same
  // draggingRef/originRef/movedRef.
  const handleDragStart = useCallback((point: { clientX: number; clientY: number }) => {
    originRef.current = { clientX: point.clientX, clientY: point.clientY };
    movedRef.current = false;
  }, []);

  const handleDragMove = useCallback((point: { clientX: number; clientY: number }) => {
    if (
      !movedRef.current &&
      (Math.abs(point.clientX - originRef.current.clientX) > CLICK_MOVE_THRESHOLD_PX ||
        Math.abs(point.clientY - originRef.current.clientY) > CLICK_MOVE_THRESHOLD_PX)
    ) {
      movedRef.current = true;
      setDraggingEventId(draggingEventRef.current?.id ?? null);
      setDraggingEventTitle(draggingEventRef.current?.title ?? null);
    }
    if (movedRef.current) {
      setHoverDate(dateAtPoint(point.clientX, point.clientY));
      setDragPointerPos({ x: point.clientX, y: point.clientY });
    }
  }, [dateAtPoint]);

  const handleDragEnd = useCallback((point: { clientX: number; clientY: number }) => {
    const draggedEvent = draggingEventRef.current;
    const moved = movedRef.current;
    draggingEventRef.current = null;
    setDraggingEventId(null);
    setDraggingEventTitle(null);
    setHoverDate(null);
    setDragPointerPos(null);
    if (draggedEvent && moved) {
      suppressClickRef.current = true;
      const dropDate = dateAtPoint(point.clientX, point.clientY);
      if (dropDate) handleDrop(draggedEvent, dropDate);
    }
  }, [dateAtPoint, handleDrop]);

  const moveDrag = usePointerDrag({
    containerRef: weeksContainerRef,
    // Month view scrolls vertically, but useAutoScroll only ever nudges
    // scrollLeft — threshold 0 means distFromLeft/Right can never be < 0, so
    // this cleanly no-ops rather than scrolling the wrong axis.
    autoScrollThreshold: 0,
    autoScrollSpeed: 0,
    onStart: handleDragStart,
    onMove: handleDragMove,
    onEnd: handleDragEnd,
  });

  return (
    <div className={styles.monthView}>
      <div className={styles.weekdayHeader}>
        {WEEKDAY_LABELS.map((label, i) => (
          <div key={label} className={styles.weekdayCell}>
            {WEEKDAY_LABELS[(i + weekStartsOn) % 7]}
          </div>
        ))}
      </div>

      <div className={styles.weeksContainer} ref={weeksContainerRef}>
        {weeks.map((weekDays, weekIndex) => {
          const { bars, hiddenCountByDay } = weekBarsAndHidden[weekIndex];
          const expanded = expandedWeeks.has(weekIndex);
          const barHeight = expanded ? BAR_HEIGHT_EXPANDED : BAR_HEIGHT_COLLAPSED;
          // Collapsed rows are always the same height (room for MAX_VISIBLE_LANES),
          // regardless of how many events that particular week actually has —
          // only an explicit "+N more" expansion grows a row beyond that.
          const maxLane = bars.reduce((max, bar) => Math.max(max, bar.lane), -1);
          const visibleLaneCount = expanded ? maxLane + 1 : MAX_VISIBLE_LANES;
          const rowMinHeight = DAY_NUMBER_HEIGHT + visibleLaneCount * barHeight + 22;

          return (
            <div
              key={weekIndex}
              className={styles.weekRow}
              style={{ minHeight: rowMinHeight }}
              ref={(el) => {
                weekRowRefs.current[weekIndex] = el;
              }}
            >
              {weekDays.map((day) => {
                const inCurrentMonth = day.getMonth() === anchorDate.getMonth();
                const isToday = isSameDay(day, today);
                const isDragOver = hoverDate !== null && isSameDay(day, hoverDate);
                return (
                  <div
                    key={day.getTime()}
                    className={[
                      styles.dayCell,
                      inCurrentMonth ? '' : styles.dayCellDim,
                      isDragOver ? styles.dayCellDragOver : '',
                    ].join(' ').trim()}
                    onClick={() => onDateClick?.(day)}
                    onMouseEnter={() => setViewDayHoverDate(day)}
                    onMouseLeave={() => setViewDayHoverDate(null)}
                  >
                    <div className={styles.dayCellHeader}>
                      <span className={[styles.dayNumber, isToday ? styles.dayNumberToday : ''].join(' ').trim()}>
                        {day.getDate()}
                      </span>
                      {onOpenDayPreview && (
                        <button
                          type="button"
                          className={[
                            styles.viewDayButton,
                            viewDayHoverDate && isSameDay(viewDayHoverDate, day) ? styles.viewDayButtonVisible : '',
                          ].join(' ').trim()}
                          // If the event details drawer happens to be open, its
                          // own document-level "click outside" listener (on
                          // mousedown, so it doesn't interrupt a drag-start on
                          // the highlighted event) would otherwise fire first,
                          // close the drawer, and free up the drawer's screen
                          // width immediately — shifting this button out from
                          // under the pointer before the click event's own hit
                          // test runs. That swallowed the whole click, needing
                          // a second one once the resize had settled.
                          // Stopping propagation here at mousedown keeps that
                          // listener from ever seeing it, so onOpenDayPreview
                          // below is now the one responsible for closing the
                          // drawer — reliably, as part of this same click.
                          onMouseDown={(e) => e.stopPropagation()}
                          onClick={(e) => {
                            e.stopPropagation();
                            onOpenDayPreview(day);
                          }}
                        >
                          <span className={styles.viewDayButtonLabel}>View day</span>
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}

              <div className={styles.barsLayer} style={{ top: DAY_NUMBER_HEIGHT }}>
                {bars
                  .filter((bar) => expanded || bar.lane < MAX_VISIBLE_LANES)
                  .map((bar) => {
                    const isDragging = bar.event.id === draggingEventId;
                    const ctx: EventRenderContext = {
                      selected: bar.event.id === selectedEventId,
                      hovered: false,
                      dragging: isDragging,
                    };
                    return (
                      <div
                        key={bar.event.id}
                        className={[
                          styles.eventBar,
                          expanded ? styles.eventBarExpanded : '',
                          bar.event.id === selectedEventId ? styles.eventBarSelected : '',
                          editable ? styles.eventBarDraggable : '',
                          isDragging ? styles.eventBarDragging : '',
                        ].join(' ').trim()}
                        style={{
                          left: `${(bar.colStart / 7) * 100}%`,
                          width: `${(bar.colSpan / 7) * 100}%`,
                          top: bar.lane * barHeight,
                          '--event-color': eventColors.get(bar.event.id) ?? 'var(--sched-accent)',
                        } as React.CSSProperties}
                        data-scheduler-event={bar.event.id}
                        onMouseEnter={() => setViewDayHoverDate(weekDays[bar.colStart])}
                        onMouseLeave={() => setViewDayHoverDate(null)}
                        onPointerDown={
                          editable
                            ? (e) => {
                                draggingEventRef.current = bar.event;
                                const rect = e.currentTarget.getBoundingClientRect();
                                setDragGrabOffset({ x: e.clientX - rect.left, y: e.clientY - rect.top });
                                moveDrag.onPointerDown(e);
                              }
                            : undefined
                        }
                        onClick={(e) => {
                          e.stopPropagation();
                          if (suppressClickRef.current) {
                            suppressClickRef.current = false;
                            return;
                          }
                          onEventClick?.(bar.event, e);
                        }}
                        onDoubleClick={(e) => {
                          e.stopPropagation();
                          onEventDoubleClick?.(bar.event, e);
                        }}
                      >
                        {renderEvent ? (
                          renderEvent(bar.event, ctx)
                        ) : (
                          <>
                            <span
                              className={styles.eventBarAvatar}
                              style={{ '--avatar-color': colorForInstructor(bar.event.instructorId) } as React.CSSProperties}
                              aria-label={bar.event.instructorName}
                              onMouseEnter={(e) => {
                                const rect = e.currentTarget.getBoundingClientRect();
                                setHoveredInstructor({
                                  name: bar.event.instructorName,
                                  x: rect.left + rect.width / 2,
                                  y: rect.top,
                                });
                              }}
                              onMouseLeave={() => setHoveredInstructor(null)}
                            >
                              {initialsFor(bar.event.instructorName)}
                            </span>
                            <span className={styles.eventBarContent}>
                              {expanded ? (
                                <>
                                  <span className={styles.eventBarTitle}>{bar.event.title}</span>
                                  <span className={styles.eventBarTimeLine}>
                                    {formatTimeRange(bar.event.start, bar.event.end)}
                                  </span>
                                </>
                              ) : (
                                <span className={styles.eventBarTitle}>
                                  <span className={styles.eventBarTimeInline}>{formatTimeOfDay(bar.event.start)}</span>{' '}
                                  {bar.event.title}
                                </span>
                              )}
                            </span>
                          </>
                        )}
                      </div>
                    );
                  })}
              </div>

              {expanded ? (
                // One toggle for the whole week (expandedWeeks is keyed by
                // week, not by day) — spans the full row rather than a
                // single day column, since "+N more" below is only ever
                // per-day because collapsing back is a single action either way.
                <button
                  type="button"
                  className={styles.showLessButton}
                  style={{ top: DAY_NUMBER_HEIGHT + visibleLaneCount * barHeight }}
                  onClick={(e) => {
                    e.stopPropagation();
                    toggleExpanded(weekIndex);
                  }}
                >
                  Show less
                </button>
              ) : (
                weekDays.map((day, dayIndex) => {
                  const hidden = hiddenCountByDay[dayIndex];
                  if (hidden === 0) return null;
                  return (
                    <button
                      key={`more-${day.getTime()}`}
                      type="button"
                      className={styles.moreButton}
                      style={{
                        left: `${(dayIndex / 7) * 100}%`,
                        width: `${(1 / 7) * 100}%`,
                        top: DAY_NUMBER_HEIGHT + MAX_VISIBLE_LANES * barHeight,
                      }}
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleExpanded(weekIndex);
                      }}
                    >
                      +{hidden} more
                    </button>
                  );
                })
              )}
            </div>
          );
        })}
      </div>

      {draggingEventId && dragPointerPos && draggingEventTitle !== null && (
        <div
          className={styles.dragGhost}
          style={{
            left: dragPointerPos.x - dragGrabOffset.x,
            top: dragPointerPos.y - dragGrabOffset.y,
            '--event-color': eventColors.get(draggingEventId) ?? 'var(--sched-accent)',
          } as React.CSSProperties}
        >
          {draggingEventTitle}
        </div>
      )}

      {hoveredInstructor && (
        <div
          className={styles.instructorTooltip}
          style={{ left: hoveredInstructor.x, top: hoveredInstructor.y }}
        >
          {hoveredInstructor.name}
        </div>
      )}
    </div>
  );
}

function computeWeekLayout(
  weekDays: Date[],
  events: SchedulerEvent[],
): { bars: WeekBar[]; hiddenCountByDay: number[] } {
  const weekStart = weekDays[0];
  const weekEndExclusive = new Date(weekStart.getTime() + 7 * DAY_MS);

  // Sorted by actual start time (not just filtered) — events sharing the
  // same day (identical colStart/colEnd, day-granular here) would otherwise
  // land in whatever lane order they happen to appear in the `events`
  // array, rather than chronologically. computeOverlapLayout's own sort is
  // on (colStart, colEnd) and stable, so this ordering survives as the
  // tiebreaker for same-day events and lane 0 ends up the day's earliest.
  const overlapping = events
    .filter((e) => e.start.getTime() < weekEndExclusive.getTime() && e.end.getTime() > weekStart.getTime())
    .sort((a, b) => a.start.getTime() - b.start.getTime());

  const withColumns = overlapping.map((event) => {
    const clampedStart = Math.max(event.start.getTime(), weekStart.getTime());
    const clampedEnd = Math.min(event.end.getTime(), weekEndExclusive.getTime());
    // Floor, not round — this is "which day contains this timestamp," not
    // "nearest day boundary." Math.round was silently rounding any event
    // whose time-of-day fell at/after noon into the *next* day's column
    // (e.g. a 2pm class rounds its 0.58-days-elapsed fractional part up),
    // which looked like some days were missing their afternoon classes.
    const colStart = Math.floor((clampedStart - weekStart.getTime()) / DAY_MS);
    const colEnd = Math.max(colStart + 1, Math.floor((clampedEnd - weekStart.getTime()) / DAY_MS));
    return { event, colStart, colEnd };
  });

  const layout = computeOverlapLayout(
    withColumns.map((c) => ({ id: c.event.id, startValue: c.colStart, endValue: c.colEnd })),
  );

  const bars: WeekBar[] = withColumns.map((c) => ({
    event: c.event,
    colStart: c.colStart,
    colSpan: c.colEnd - c.colStart,
    lane: layout.get(c.event.id)?.lane ?? 0,
  }));

  const hiddenCountByDay = weekDays.map((_, dayIndex) =>
    bars.filter((bar) => dayIndex >= bar.colStart && dayIndex < bar.colStart + bar.colSpan && bar.lane >= MAX_VISIBLE_LANES).length,
  );

  return { bars, hiddenCountByDay };
}
