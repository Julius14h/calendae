import { useEffect, useMemo, useRef, useState } from 'react';
import { Maximize2, Minimize2 } from 'lucide-react';
import { EventBlock } from './EventBlock';
import { computeOverlapLayout } from './utils/overlapLayout';
import { computeRowLayout } from './utils/rowLayout';
import { computeAvailabilityBands } from './utils/availabilityOverlay';
import { createTimelineGeometry, dateToX, durationToWidthPx, hoursOfDay } from './utils/timeGeometry';
import { formatHourLabel, isSameDay, monthLabel, weekdayLabel } from './utils/dateMath';
import { useElementWidth } from './hooks/useElementWidth';
import type { InstructorOption, Resource, SchedulerEvent, SchedulerProps } from './Scheduler.types';
import styles from './WeekViewVertical.module.css';

// Unlike the horizontal timeline (whose slot width grows to fill the
// container), both axes here are fixed pixel sizes — the whole point of a
// vertical time axis is that it can be a long scrollable list, and room
// columns repeat identically for every day, so there's no "fit to width"
// concept to compute. This also means, unlike MonthDayPreviewModal/
// MonthMoveConflictModal, no width-measurement gate is needed before mounting.
const ROOM_COLUMN_WIDTH_PX = 130;
const PX_PER_MINUTE = 2; // 120px per hour — tall enough that a 15-30min class still has room for its title/time text
const HOUR_GUTTER_WIDTH_PX = 64;
// Width of the between-day divider drawn in the canvas — see the standalone
// `.dayBoundaryLine` element below (deliberately NOT a border on the last
// room column itself, which would sit under an edge-to-edge event and get
// visually covered by it; this draws above every event instead).
const DAY_BOUNDARY_LINE_WIDTH_PX = 2;

// Matches AvailabilityOverlay.tsx's own LEVEL_CLASS pattern — a static map
// rather than dynamic `styles[...]` bracket access, which CSS-module typing
// here doesn't support cleanly.
const AVAILABILITY_LEVEL_CLASS = {
  preferred: styles.availabilityPreferred,
  available: styles.availabilityAvailable,
  unavailable: styles.availabilityUnavailable,
} as const;

// Composite key for maps/sets scoped to one (resource, day) pair — a room
// squished or expanded on one day says nothing about any other day, so
// resourceId alone isn't a fine-grained-enough key here (unlike
// TimelineView.tsx's own resourceId-only expand Set, which has no day axis
// to scope by).
function dayResourceKey(resourceId: string, dayIndex: number): string {
  return `${resourceId}|${dayIndex}`;
}

export interface WeekViewVerticalProps {
  /** The week's dates, in day-group order (left to right). */
  days: Date[];
  resources: Resource[];
  events: SchedulerEvent[];
  eventColors: Map<string, string>;
  instructors: InstructorOption[];
  /** The event currently open in the details drawer — its move-target feasibility overlay is shown across all rooms in its own day-group. */
  highlightEvent: SchedulerEvent | null;
  dayStartHour: number;
  dayEndHour: number;
  slotMinutes: number;
  snapMinutes: number;
  editable: boolean;
  autoScrollThreshold: number;
  autoScrollSpeed: number;
  selectedEventId: string | null;
  onEventInteractionStart?: (event: SchedulerEvent) => void;
  hiddenClassTypes: Set<string>;
  hiddenInstructorIds: Set<number>;
  renderEvent?: SchedulerProps['renderEvent'];
  onEventClick?: SchedulerProps['onEventClick'];
  onEventDoubleClick?: SchedulerProps['onEventDoubleClick'];
  onEventMove?: SchedulerProps['onEventMove'];
  onEventResizeStart?: SchedulerProps['onEventResizeStart'];
  onEventResize?: SchedulerProps['onEventResize'];
  onEventResizeEnd?: SchedulerProps['onEventResizeEnd'];
}

/**
 * The vertical-orientation alternative to TimelineView for Week view: each
 * day is its own column group, split into per-room sub-columns (repeating
 * the same room set every day), with time running top-to-bottom and shared
 * across every day-group via one continuous vertical scroll. Deliberately a
 * wholly separate component from TimelineView.tsx (matching MonthView.tsx's
 * own precedent) rather than an orientation branch inside it — TimelineView
 * is heavily depended-on (virtualization, wheel-redirect, sticky headers) by
 * Day/Week-horizontal and Month's own modals, and safer left untouched.
 *
 * Owns its own scroll container rather than sharing Scheduler.tsx's — see
 * the plan doc: Scheduler.tsx's scroll-to-today effect and
 * scrollToTime/scrollToResource are gated on `view === 'month'` only, so a
 * shared ref/geometry here would silently act on the wrong container.
 * scrollToTime/scrollToResource are simply no-ops while this is showing.
 */
export function WeekViewVertical({
  days,
  resources,
  events,
  eventColors,
  instructors,
  highlightEvent,
  dayStartHour,
  dayEndHour,
  slotMinutes,
  snapMinutes,
  editable,
  autoScrollThreshold,
  autoScrollSpeed,
  selectedEventId,
  onEventInteractionStart,
  hiddenClassTypes,
  hiddenInstructorIds,
  renderEvent,
  onEventClick,
  onEventDoubleClick,
  onEventMove,
  onEventResizeStart,
  onEventResize,
  onEventResizeEnd,
}: WeekViewVerticalProps) {
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  // Time-of-day → pixel conversion only — dateToX/xToDate resolve day-index
  // internally, but with a single placeholder day they always resolve to
  // that one day, so the result is purely a function of hours/minutes
  // regardless of which real calendar day a given Date actually falls on.
  // That's what lets every day-group share this one geometry object.
  const timeGeometry = useMemo(() => {
    const slotWidthPx = slotMinutes * PX_PER_MINUTE;
    return createTimelineGeometry({
      days: [days[0] ?? new Date()],
      slotMinutes,
      snapMinutes,
      slotWidthPx,
      dayStartHour,
      dayEndHour,
    });
  }, [days, slotMinutes, snapMinutes, dayStartHour, dayEndHour]);

  const dayHeightPx = timeGeometry.dayWidthPx;

  const visibleEvents = useMemo(
    () =>
      events.filter(
        (event) =>
          days.some((day) => isSameDay(day, event.start)) &&
          !(event.type && hiddenClassTypes.has(event.type)) &&
          !hiddenInstructorIds.has(event.instructorId),
      ),
    [events, days, hiddenClassTypes, hiddenInstructorIds],
  );

  // Per-event lane assignment, plus the busiest cluster's lane count per
  // (resource, day) pair — the latter decides both whether a given
  // day-group's room-header cell needs an expand button at all, and (once
  // expanded) how wide that one day-group's column needs to be to give
  // every lane its own full-width slot. Scoped to one specific day, not the
  // whole week: lane assignment is keyed on absolute timestamps, so events
  // on different days never overlap each other regardless — a resource
  // being squished on Monday says nothing about whether it's squished on
  // Tuesday, and expand state (below) is scoped the same way, so a room
  // that isn't actually squished on a given day never needs to grow (or
  // show a button) there.
  const { laneInfoByEventId, maxLaneCountByResourceDay } = useMemo(() => {
    const byResource = new Map<string, SchedulerEvent[]>();
    for (const event of visibleEvents) {
      const list = byResource.get(event.resourceId);
      if (list) list.push(event);
      else byResource.set(event.resourceId, [event]);
    }
    const laneInfo = new Map<string, { lane: number; laneCount: number }>();
    const maxLaneCountByResourceDay = new Map<string, number>();
    for (const [resourceId, resourceEvents] of byResource) {
      const layout = computeOverlapLayout(
        resourceEvents.map((e) => ({ id: e.id, startValue: e.start.getTime(), endValue: e.end.getTime() })),
      );
      for (const event of resourceEvents) {
        const info = layout.get(event.id);
        if (!info) continue;
        laneInfo.set(event.id, info);
        const dayIndex = days.findIndex((d) => isSameDay(d, event.start));
        if (dayIndex === -1) continue;
        const dayKey = dayResourceKey(resourceId, dayIndex);
        maxLaneCountByResourceDay.set(dayKey, Math.max(maxLaneCountByResourceDay.get(dayKey) ?? 1, info.laneCount));
      }
    }
    return { laneInfoByEventId: laneInfo, maxLaneCountByResourceDay };
  }, [visibleEvents, days]);

  // Rooms manually expanded to give every overlapping event its own
  // full-width lane instead of being squished — local to this component and
  // keyed by (resourceId, dayIndex), NOT the resourceId-only Set
  // TimelineView.tsx uses for its own row-expand toggle: TimelineView shows
  // one row per resource for the whole week (no day axis to scope by), but
  // here the same room reappears once per day-group, and expanding it on
  // one day must not silently widen (and shift) every *other* day's column
  // for that same room too — see the button-position bug this fixed.
  // Reset whenever the visible days change (a different week, or navigating
  // away from Week view and back) so stale expand state from a past week
  // never lingers under a coincidentally-matching day index. Reset during
  // render (React's documented "adjusting state when a prop changes"
  // recipe), not in an effect — an effect would apply the reset one render
  // late, letting the stale-week state paint for a frame first.
  const [expandedKeys, setExpandedKeys] = useState<Set<string>>(new Set());
  const [prevDays, setPrevDays] = useState(days);
  if (days !== prevDays) {
    setPrevDays(days);
    setExpandedKeys(new Set());
  }
  function toggleExpanded(resourceId: string, dayIndex: number) {
    const key = dayResourceKey(resourceId, dayIndex);
    setExpandedKeys((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  // Every (resource, day) pair that actually has a per-cell expand button —
  // i.e. every key toggleExpanded could ever be called with. "Expand all"
  // only ever expands these (same as TimelineView.tsx's own
  // expandableResourceIds); "collapse all" is available whenever any of
  // them is currently expanded.
  const expandableKeys = useMemo(
    () =>
      Array.from(maxLaneCountByResourceDay.entries())
        .filter(([, count]) => count > 1)
        .map(([key]) => key),
    [maxLaneCountByResourceDay],
  );
  const allExpanded = expandableKeys.length > 0 && expandableKeys.every((key) => expandedKeys.has(key));
  function toggleAllExpanded() {
    setExpandedKeys(allExpanded ? new Set() : new Set(expandableKeys));
  }

  // Each (day, room) pair's own column width — collapsed (the ordinary
  // ROOM_COLUMN_WIDTH_PX) unless manually expanded AND it actually has
  // overlapping events that day, in which case every lane gets a full
  // ROOM_COLUMN_WIDTH_PX slot side by side instead of being squished into
  // shared width (mirroring TimelineView.tsx's EXPANDED_LANE_HEIGHT: an
  // expanded lane looks identical to an ordinary, unsquished one). Per day,
  // not uniform across the week — so expanding one day-group's room only
  // ever pushes THAT day's later rooms (and every day-group after it)
  // outward; earlier day-groups, and the button just clicked, never move.
  const resourceWidthsByDay = useMemo(
    () =>
      days.map((_day, dayIndex) =>
        resources.map((resource) => {
          const maxLaneCount = maxLaneCountByResourceDay.get(dayResourceKey(resource.id, dayIndex)) ?? 1;
          return expandedKeys.has(dayResourceKey(resource.id, dayIndex)) && maxLaneCount > 1
            ? maxLaneCount * ROOM_COLUMN_WIDTH_PX
            : ROOM_COLUMN_WIDTH_PX;
        }),
      ),
    [days, resources, maxLaneCountByResourceDay, expandedKeys],
  );
  const dayGroupWidths = useMemo(
    () => resourceWidthsByDay.map((widths) => widths.reduce((sum, w) => sum + w, 0)),
    [resourceWidthsByDay],
  );
  // Prefix sums of dayGroupWidths — the absolute left offset of each
  // day-group, now that day-groups are no longer all the same width.
  const dayGroupOffsets = useMemo(() => {
    const offsets: number[] = [];
    let acc = 0;
    for (const width of dayGroupWidths) {
      offsets.push(acc);
      acc += width;
    }
    return offsets;
  }, [dayGroupWidths]);
  const totalCanvasWidthPx = useMemo(() => dayGroupWidths.reduce((sum, w) => sum + w, 0), [dayGroupWidths]);

  // Flat (day, room) column layout — day-major, `dayIndex * resources.length
  // + roomIndex`, concatenating each day-group's own `resourceWidthsByDay`
  // row in order (no longer a single array repeated per day, now that
  // widths can differ day to day). computeRowLayout/rowIndexAtY (EventBlock's
  // own internal room-axis lookup during a drag) are already
  // variable-size-safe, so this non-uniform `heights` input needs no
  // changes there; see EventBlockProps' own doc comment on `rowLayout`.
  const flatColumnLayout = useMemo(() => {
    const widths: number[] = [];
    for (const dayWidths of resourceWidthsByDay) widths.push(...dayWidths);
    return computeRowLayout(widths);
  }, [resourceWidthsByDay]);

  const availabilityBands = useMemo(() => {
    if (!highlightEvent) return [];
    const instructor = instructors.find((i) => i.id === highlightEvent.instructorId);
    if (!instructor) return [];
    // Always the full, unfiltered `events` — availability needs the true
    // picture, not the hidden-class-type/instructor display filter above.
    return computeAvailabilityBands(highlightEvent, instructor, resources, events, days, dayStartHour, dayEndHour);
  }, [highlightEvent, instructors, resources, events, days, dayStartHour, dayEndHour]);

  // Refreshed periodically (not on every render) — mirrors
  // CurrentTimeIndicator.tsx's own interval-plus-visibilitychange approach,
  // reimplemented here since that component's API assumes one shared
  // multi-day geometry spanning the whole canvas, which doesn't apply once
  // every day-group has its own independent time origin.
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 60_000);
    function handleVisibility() {
      if (document.visibilityState === 'visible') setNow(new Date());
    }
    document.addEventListener('visibilitychange', handleVisibility);
    return () => {
      window.clearInterval(id);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, []);
  const nowWithinBusinessHours = now.getHours() >= dayStartHour && now.getHours() < dayEndHour;

  // Scrolls horizontally so today's day-group is the first thing in view
  // whenever the displayed week actually contains today — covers opening
  // Week view fresh, navigating prev/next back into the week containing
  // today, and clicking "Today" while already here, all through the one
  // `days` dependency, with no separate wiring for each. Deliberately not
  // routed through Scheduler.tsx's own scroll-to-today mechanism: that one
  // targets its *shared* scrollContainerRef, which this view doesn't use
  // (see this component's own doc comment on why it owns a local ref
  // instead) — TimelineView.tsx's `RESOURCE_COLUMN_WIDTH`/`containerWidth`
  // "center on now" math there also doesn't translate directly, since
  // there's no equivalent live container-width measurement here (this view
  // is fixed-pixel-sized throughout, deliberately without one — see the
  // `ROOM_COLUMN_WIDTH_PX` comment above). Aligning today's day-group flush
  // against the sticky hour gutter (rather than centering it) sidesteps
  // needing that measurement at all.
  // dayGroupOffsets is read via a ref, not a dependency, deliberately:
  // toggling a room's expand/collapse state changes dayGroupOffsets (see
  // resourceWidthsByDay above) without changing which week is showing, and
  // re-running this scroll-to-today jump on every such toggle is exactly
  // the "button moves and I have to hunt for it to collapse again"
  // problem — this should only fire when the visible week itself changes.
  const dayGroupOffsetsRef = useRef(dayGroupOffsets);
  useEffect(() => {
    dayGroupOffsetsRef.current = dayGroupOffsets;
  });
  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;
    // Computed fresh here rather than reading the `now` state above —
    // that state only exists to refresh the current-time line every
    // minute, and re-running this scroll on that same 60s cadence would
    // keep yanking the view back to today out from under someone who's
    // since scrolled away on purpose.
    const today = new Date();
    const todayIndex = days.findIndex((d) => isSameDay(d, today));
    if (todayIndex === -1) return;
    container.scrollLeft = dayGroupOffsetsRef.current[todayIndex] ?? 0;
  }, [days]);

  // A *different* reason to measure this container's width than the one the
  // comment above rules out (this view's own column layout is genuinely
  // fixed-pixel, no "fit to container" sizing to compute): the sticky
  // details drawer (rendered by Scheduler.tsx, a sibling of this whole
  // component) shrinks the shared flex row this scrollContainer sits in
  // whenever it opens — and the event just double-clicked open in it can be
  // sitting anywhere, including right at the far edge of the scrollable
  // week, where the browser's own scroll-anchoring heuristic has nothing
  // beyond the viewport left to anchor against and simply strands the event
  // behind where the drawer now sits. See Scheduler.tsx's own analogous fix
  // for TimelineView (horizontal mode) — this mirrors it for vertical mode's
  // own, separate scroll container.
  const containerWidth = useElementWidth(scrollContainerRef);
  useEffect(() => {
    const container = scrollContainerRef.current;
    const selectedEvent = events.find((e) => e.id === selectedEventId);
    if (!container || !selectedEvent) return;
    const dayIndex = days.findIndex((d) => isSameDay(d, selectedEvent.start));
    const roomIndex = resources.findIndex((r) => r.id === selectedEvent.resourceId);
    if (dayIndex === -1 || roomIndex === -1) return;
    const flatIndex = dayIndex * resources.length + roomIndex;
    const left = flatColumnLayout.offsets[flatIndex] ?? 0;
    const width = resourceWidthsByDay[dayIndex]?.[roomIndex] ?? 0;
    const requiredMinScrollLeft = HOUR_GUTTER_WIDTH_PX + left + width - containerWidth;
    // When a correction is needed, jump to the *farthest* position that
    // still keeps the event's own left edge on-screen — min(maxScrollLeft,
    // left) — not just the bare minimum needed to reveal its right edge.
    // The minimum-adjustment version left later same-day rooms (e.g. the
    // last room in the week's last day-group) stranded just past the new,
    // narrower edge even though they were visible a moment before — see
    // Scheduler.tsx's own matching comment for TimelineView.
    if (container.scrollLeft > left || container.scrollLeft < requiredMinScrollLeft) {
      const maxScrollLeft = container.scrollWidth - container.clientWidth;
      container.scrollLeft = Math.min(maxScrollLeft, left);
    }
  }, [selectedEventId, events, days, resources, flatColumnLayout, resourceWidthsByDay, containerWidth]);

  const hours = hoursOfDay(timeGeometry);

  return (
    <div className={styles.weekViewVertical}>
      <div className={styles.scrollContainer} ref={scrollContainerRef}>
        <div className={styles.grid} style={{ width: HOUR_GUTTER_WIDTH_PX + totalCanvasWidthPx }}>
          <div className={styles.headerRow}>
            <div className={styles.cornerCell} style={{ width: HOUR_GUTTER_WIDTH_PX }}>
              {/* An empty spacer sharing .dayLabel's own class (not a
                  hardcoded pixel height) so it always matches that row's
                  real rendered height exactly, whatever the font metrics —
                  &nbsp; (not truly empty) so the browser still generates a
                  line box to size against, the same as every real day label
                  does. Without this, the bottom section's own border-right
                  had to span the corner's FULL height (day-label row + room
                  row combined, since the corner had no internal split),
                  starting well above where every other vertical divider
                  starts (those only span the room row) — see the bug this
                  fixes. */}
              <div className={styles.dayLabel} aria-hidden="true">
                &nbsp;
              </div>
              <div className={styles.cornerBottomCell}>
                {expandableKeys.length > 0 && (
                  <button
                    type="button"
                    className={[styles.expandButton, styles.expandAllButton].join(' ')}
                    onClick={toggleAllExpanded}
                    aria-pressed={allExpanded}
                    aria-label={allExpanded ? 'Collapse all rooms' : 'Expand all rooms with overlapping events'}
                    title={allExpanded ? 'Collapse all rooms' : 'Expand all rooms with overlapping events'}
                  >
                    {allExpanded ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
                  </button>
                )}
              </div>
            </div>
            {days.map((day, dayIndex) => (
              <div key={day.getTime()} className={styles.dayGroup} style={{ width: dayGroupWidths[dayIndex] }}>
                <div className={styles.dayLabel}>
                  {weekdayLabel(day)}, {monthLabel(day)} {day.getDate()}
                </div>
                <div className={styles.roomHeaderRow}>
                  {resources.map((resource, roomIndex) => {
                    const daySquished = (maxLaneCountByResourceDay.get(dayResourceKey(resource.id, dayIndex)) ?? 1) > 1;
                    const expanded = expandedKeys.has(dayResourceKey(resource.id, dayIndex));
                    return (
                      <div
                        key={resource.id}
                        className={[
                          styles.roomHeaderCell,
                          roomIndex === resources.length - 1 && dayIndex !== days.length - 1 ? styles.dayBoundary : '',
                        ].join(' ').trim()}
                        style={{ width: resourceWidthsByDay[dayIndex][roomIndex] }}
                      >
                        <div className={styles.roomHeaderContent} style={{ width: ROOM_COLUMN_WIDTH_PX }}>
                          <span className={styles.roomHeaderTitle}>{resource.title}</span>
                          {daySquished && (
                            <button
                              type="button"
                              className={styles.expandButton}
                              onClick={() => toggleExpanded(resource.id, dayIndex)}
                              aria-pressed={expanded}
                              aria-label={expanded ? `Collapse ${resource.title}` : `Expand ${resource.title} to fit overlapping events`}
                              title={expanded ? 'Collapse column' : 'Expand column to fit overlapping events'}
                            >
                              {expanded ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>

          <div className={styles.bodyRow}>
            <div className={styles.hourGutter} style={{ width: HOUR_GUTTER_WIDTH_PX }}>
              {hours.map((hour) => (
                <div key={hour} className={styles.hourLabel} style={{ height: 60 * PX_PER_MINUTE }}>
                  {formatHourLabel(hour)}
                </div>
              ))}
            </div>

            <div className={styles.canvas} style={{ width: totalCanvasWidthPx, height: dayHeightPx }}>
              {days.map((day, dayIndex) =>
                resources.map((resource, roomIndex) => {
                  const flatIndex = dayIndex * resources.length + roomIndex;
                  return (
                    <div
                      key={`${day.getTime()}-${resource.id}`}
                      className={styles.roomColumnBg}
                      style={{ left: flatColumnLayout.offsets[flatIndex], width: resourceWidthsByDay[dayIndex][roomIndex], height: dayHeightPx }}
                    >
                      {hours.map((hour) => (
                        <div key={hour} className={styles.hourCell} style={{ height: 60 * PX_PER_MINUTE }} />
                      ))}
                    </div>
                  );
                }),
              )}

              {highlightEvent &&
                availabilityBands.map((band, i) => {
                  const dayIndex = days.findIndex((d) => isSameDay(d, band.start));
                  const roomIndex = resources.findIndex((r) => r.id === band.resourceId);
                  if (dayIndex === -1 || roomIndex === -1) return null;
                  const flatIndex = dayIndex * resources.length + roomIndex;
                  return (
                    <div
                      key={i}
                      className={[styles.availabilityBand, AVAILABILITY_LEVEL_CLASS[band.level]].join(' ')}
                      style={{
                        left: flatColumnLayout.offsets[flatIndex],
                        width: resourceWidthsByDay[dayIndex][roomIndex],
                        top: dateToX(band.start, timeGeometry),
                        height: durationToWidthPx(band.start, band.end, timeGeometry),
                      }}
                    />
                  );
                })}

              {days.map(
                (day, dayIndex) =>
                  isSameDay(day, now) &&
                  nowWithinBusinessHours && (
                    <div
                      key={day.getTime()}
                      className={styles.nowLine}
                      style={{ left: dayGroupOffsets[dayIndex], width: dayGroupWidths[dayIndex], top: dateToX(now, timeGeometry) }}
                    />
                  ),
              )}

              {/* Between-day dividers — a standalone layer drawn ABOVE every
                  event (see .dayBoundaryLine's z-index) rather than a border
                  on the last room column itself, which an edge-to-edge event
                  would otherwise paint over. One per internal boundary
                  (day 0 has no divider before it). */}
              {days.slice(1).map((day, i) => (
                <div
                  key={day.getTime()}
                  className={styles.dayBoundaryLine}
                  style={{ left: dayGroupOffsets[i + 1] - DAY_BOUNDARY_LINE_WIDTH_PX, width: DAY_BOUNDARY_LINE_WIDTH_PX, height: dayHeightPx }}
                />
              ))}

              {visibleEvents.map((event) => {
                const info = laneInfoByEventId.get(event.id) ?? { lane: 0, laneCount: 1 };
                const eventDayIndex = days.findIndex((d) => isSameDay(d, event.start));
                const expanded = eventDayIndex !== -1 && expandedKeys.has(dayResourceKey(event.resourceId, eventDayIndex)) && info.laneCount > 1;
                const laneWidth = expanded ? ROOM_COLUMN_WIDTH_PX : ROOM_COLUMN_WIDTH_PX / info.laneCount;
                return (
                  <EventBlock
                    key={event.id}
                    event={event}
                    color={eventColors.get(event.id) ?? 'var(--sched-accent)'}
                    geometry={timeGeometry}
                    editable={editable}
                    resources={resources}
                    rowLayout={flatColumnLayout}
                    laneTop={info.lane * laneWidth}
                    laneHeight={laneWidth}
                    squished={info.laneCount > 1 && !expanded}
                    orientation="vertical"
                    days={days}
                    containerRef={scrollContainerRef}
                    autoScrollThreshold={autoScrollThreshold}
                    autoScrollSpeed={autoScrollSpeed}
                    selected={event.id === selectedEventId}
                    onInteractionStart={onEventInteractionStart}
                    renderEvent={renderEvent}
                    onEventClick={onEventClick}
                    onEventDoubleClick={onEventDoubleClick}
                    onEventMove={onEventMove}
                    onEventResizeStart={onEventResizeStart}
                    onEventResize={onEventResize}
                    onEventResizeEnd={onEventResizeEnd}
                  />
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
