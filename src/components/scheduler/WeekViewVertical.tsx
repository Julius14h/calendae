import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Maximize2, Minimize2, Pencil } from 'lucide-react';
import { EventBlock } from './EventBlock';
import { computeOverlapLayout } from './utils/overlapLayout';
import { computeRowLayout } from './utils/rowLayout';
import { computeAvailabilityBands } from './utils/availabilityOverlay';
import { createTimelineGeometry, dateToX, durationToWidthPx, hoursOfDay, xToDate } from './utils/timeGeometry';
import { formatHourLabel, isSameDay, monthLabel, weekdayLabel } from './utils/dateMath';
import { useElementWidth } from './hooks/useElementWidth';
import { usePanScroll } from './hooks/usePanScroll';
import type { InstructorOption, PendingSelection, Resource, SchedulerEvent, SchedulerProps } from './Scheduler.types';
import styles from './WeekViewVertical.module.css';

// The time axis (vertical) is a fixed pixel size regardless of container
// height — the whole point of it is a long scrollable list, not something
// that fits to the viewport. The room-column axis (horizontal), though,
// mirrors TimelineView.tsx's own MIN_SLOT_WIDTH_PX: this is only the FLOOR a
// room column ever shrinks to — see `roomColumnWidthPx` below, which grows
// columns to fill any leftover container width instead of leaving it empty.
// Unlike MonthDayPreviewModal/MonthMoveConflictModal's own TimelineView
// usage, no width-measurement gate is needed before mounting here — this
// measures its own scrollContainer directly (see `containerWidth` below)
// rather than depending on an ancestor's width settling first.
const MIN_ROOM_COLUMN_WIDTH_PX = 130;
// Exported: Scheduler.tsx's own pending-booking "staging chip" drop handler
// (see its own doc comment) needs this same px/minute ratio to convert a
// raw drop Y position back into a time-of-day, without duplicating this
// view's internal geometry object (which is a single-placeholder-day
// timeGeometry, not something worth lifting up just for this).
export const PX_PER_MINUTE = 2; // 120px per hour — tall enough that a 15-30min class still has room for its title/time text
const HOUR_GUTTER_WIDTH_PX = 64;
// Width of the between-day divider drawn in the canvas — see the standalone
// `.dayBoundaryLine` element below (deliberately NOT a border on the last
// room column itself, which would sit under an edge-to-edge event and get
// visually covered by it; this draws above every event instead).
const DAY_BOUNDARY_LINE_WIDTH_PX = 2;
// Below this, a drag-to-select gesture is treated as a plain click instead
// (see handleSelectionPointerDown) — mirrors ResourceRow.tsx's own
// CLICK_MOVE_THRESHOLD_PX for the same reason (ordinary pointer jitter
// between down/up shouldn't register as an intentional selection).
const SELECTION_MOVE_THRESHOLD_PX = 3;

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
  /** The currently selected event (open in the event popover) — its move-target feasibility overlay is shown across all rooms in its own day-group. */
  highlightEvent: SchedulerEvent | null;
  dayStartHour: number;
  dayEndHour: number;
  slotMinutes: number;
  snapMinutes: number;
  editable: boolean;
  autoScrollThreshold: number;
  autoScrollSpeed: number;
  selectedEventId: string | null;
  /** Ids of every OTHER placed event sharing the open popover's own classRequestId — see Scheduler.tsx's own doc comment and EventBlockProps' `sameClassType`. */
  sameClassEventIds: ReadonlySet<string>;
  onEventInteractionStart?: (event: SchedulerEvent) => void;
  hiddenClassTypes: Set<string>;
  hiddenInstructorIds: Set<number>;
  /** Event ids with an open ADVISORY "Classes to review" issue — see Scheduler.tsx's own doc comment and EventBlockProps' `flagged`. */
  flaggedEventIds?: Set<string>;
  /** Event ids with an open BLOCKING issue (instructor genuinely unavailable) — see EventBlockProps' `blocking`. */
  blockingEventIds?: Set<string>;
  /** A drag-select awaiting the "new event" drawer — kept highlighted in its own (room, day) cell until that drawer closes. Same idea as TimelineView's own `pendingSelection` prop. */
  pendingSelection?: PendingSelection | null;
  onSelection?: SchedulerProps['onSelection'];
  /** True while dragging the empty background should pan instead of select — same convention as TimelineView's own prop of the same name (there it gates ResourceRow's own `editable`; here it directly picks pan vs. select on each room-column cell). Selection is opt-in (defaults to disabled, i.e. always pan) since this view historically had no selection support at all — see this component's own doc comment. */
  disableRowSelection?: boolean;
  /** Opens RoomModal.tsx in edit mode for this room — the pencil icon shown above a room's own name while its header cell is hovered (see the room header's own `min-height`, grown specifically to fit this without shifting anything else when it fades in/out). */
  onEditRoom?: (resource: Resource) => void;
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
  sameClassEventIds,
  onEventInteractionStart,
  hiddenClassTypes,
  hiddenInstructorIds,
  flaggedEventIds,
  blockingEventIds,
  pendingSelection,
  onSelection,
  disableRowSelection = true,
  onEditRoom,
  renderEvent,
  onEventClick,
  onEventDoubleClick,
  onEventMove,
  onEventResizeStart,
  onEventResize,
  onEventResizeEnd,
}: WeekViewVerticalProps) {
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  // Also feeds `roomColumnWidthPx` below (declared here, ahead of that, since
  // it's read further down for the selected-event scroll correction too).
  const containerWidth = useElementWidth(scrollContainerRef);

  // Grab-and-drag panning on the empty room-column background — the
  // default, and the only option while `disableRowSelection` (see this
  // component's own doc comment on that prop). While selection IS enabled
  // (the "Add class" drawer is open — see Scheduler.tsx's own
  // handleAddClassFab/pendingSelection), a background drag instead reports
  // a new (resourceId, start, end) via `onSelection`, mirroring
  // TimelineView/ResourceRow's own long-standing drag-to-select — the two
  // are mutually exclusive per gesture, same as there.
  const pan = usePanScroll({ containerRef: scrollContainerRef });

  // The in-progress drag itself (not yet released) — null the rest of the
  // time. Deliberately NOT usePointerDrag (every other drag in this file
  // uses it): that hook's own content coordinates are relative to
  // `containerRef`'s own top-left, which here would include the sticky
  // header's height, needing that measured/subtracted first. Simpler to
  // just capture the SPECIFIC cell's own getBoundingClientRect() once, at
  // the moment the drag starts on it — every following pointermove/up need
  // only subtract that same fixed reference point, no header math at all.
  // Room/day are fixed to whichever cell the drag started in (matching
  // ResourceRow's own behavior — a resource-row drag never crosses rows
  // either); only the time range changes as the pointer moves vertically.
  const [activeSelection, setActiveSelection] = useState<{ resourceId: string; dayIndex: number; y1: number; y2: number } | null>(null);
  // Mirrors `activeSelection` outside React state so handleUp can read its
  // latest value synchronously, the same reasoning as EventBlock.tsx's own
  // previewRef: calling onSelection (which itself calls setState further up
  // the tree, in Scheduler.tsx) from inside a setActiveSelection updater
  // function is exactly the "Cannot update a component while rendering a
  // different component" hazard — updater functions can be invoked during
  // render, not just at the moment setState is called, so a side effect
  // inside one fires at the wrong time. Reading this ref in a plain
  // function body (not a setState updater) sidesteps that entirely.
  const activeSelectionRef = useRef<typeof activeSelection>(null);
  const setActiveSelectionAndRef = useCallback((next: typeof activeSelection) => {
    activeSelectionRef.current = next;
    setActiveSelection(next);
  }, []);

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

  const handleRoomColumnPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>, resourceId: string, dayIndex: number) => {
      if (disableRowSelection || !onSelection) {
        pan.onPointerDown(e);
        return;
      }
      e.stopPropagation();
      const cellRect = e.currentTarget.getBoundingClientRect();
      const startY = Math.min(Math.max(e.clientY - cellRect.top, 0), dayHeightPx);
      setActiveSelectionAndRef({ resourceId, dayIndex, y1: startY, y2: startY });

      function handleMove(ev: PointerEvent) {
        const current = activeSelectionRef.current;
        if (!current) return;
        const y = Math.min(Math.max(ev.clientY - cellRect.top, 0), dayHeightPx);
        setActiveSelectionAndRef({ ...current, y2: y });
      }
      function handleUp(ev: PointerEvent) {
        window.removeEventListener('pointermove', handleMove);
        window.removeEventListener('pointerup', handleUp);
        const current = activeSelectionRef.current;
        setActiveSelectionAndRef(null);
        if (!current) return;
        const endY = Math.min(Math.max(ev.clientY - cellRect.top, 0), dayHeightPx);
        const y1 = Math.min(current.y1, endY);
        const y2 = Math.max(current.y1, endY);
        if (y2 - y1 > SELECTION_MOVE_THRESHOLD_PX) {
          const day = days[dayIndex] ?? new Date();
          const startTime = xToDate(y1, timeGeometry);
          const endTime = xToDate(y2, timeGeometry);
          const start = new Date(
            day.getFullYear(), day.getMonth(), day.getDate(),
            startTime.getHours(), startTime.getMinutes(), 0, 0,
          );
          const end = new Date(
            day.getFullYear(), day.getMonth(), day.getDate(),
            endTime.getHours(), endTime.getMinutes(), 0, 0,
          );
          onSelection?.(resourceId, start, end);
        }
      }
      window.addEventListener('pointermove', handleMove);
      window.addEventListener('pointerup', handleUp);
    },
    [disableRowSelection, onSelection, pan, dayHeightPx, timeGeometry, days, setActiveSelectionAndRef],
  );

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
  // Which (resource, day) cell's expand/collapse toggle to reveal — hidden
  // at rest, shown while any part of that cell's own room-day "row" (its
  // header cell, canvas column background, or one of its events — three
  // separate DOM subtrees) is hovered. Mirrors TimelineView.tsx's own
  // hoveredResourceId, just keyed by day too since a room's squished state
  // here is scoped per day, not per week.
  const [hoveredKey, setHoveredKey] = useState<string | null>(null);
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

  // The base (collapsed, unexpanded) width every room column gets — grows
  // to fill any leftover container width beyond what the fixed
  // MIN_ROOM_COLUMN_WIDTH_PX floor needs, evenly across every room-day slot
  // currently on screen, the same "floor, then grow to fill" shape as
  // TimelineView.tsx's own MIN_SLOT_WIDTH_PX. Deliberately ignores expand
  // state (an expanded room's extra lanes are added on TOP of this base
  // below, not folded into everyone else's share) — otherwise expanding one
  // room would shrink every other room's base width too.
  const roomColumnWidthPx = useMemo(() => {
    const totalSlots = days.length * resources.length;
    if (totalSlots === 0) return MIN_ROOM_COLUMN_WIDTH_PX;
    const availableWidth = Math.max(0, containerWidth - HOUR_GUTTER_WIDTH_PX);
    return Math.max(MIN_ROOM_COLUMN_WIDTH_PX, Math.floor(availableWidth / totalSlots));
  }, [containerWidth, days.length, resources.length]);

  // Each (day, room) pair's own column width — collapsed (the ordinary
  // roomColumnWidthPx) unless manually expanded AND it actually has
  // overlapping events that day, in which case every lane gets a full
  // roomColumnWidthPx slot side by side instead of being squished into
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
            ? maxLaneCount * roomColumnWidthPx
            : roomColumnWidthPx;
        }),
      ),
    [days, resources, maxLaneCountByResourceDay, expandedKeys, roomColumnWidthPx],
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
  // instead) — TimelineView.tsx's own "center on now" math there also
  // doesn't translate directly: aligning today's day-group flush against
  // the sticky hour gutter (rather than centering it) is simpler and needs
  // no extra container-width math beyond what `roomColumnWidthPx` (see the
  // `MIN_ROOM_COLUMN_WIDTH_PX` comment above) already measures.
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

  // `containerWidth` (declared up top) also feeds `roomColumnWidthPx` — see
  // that memo above for why it's measured.

  const hours = hoursOfDay(timeGeometry);

  return (
    <div className={styles.weekViewVertical}>
      <div className={styles.scrollContainer} ref={scrollContainerRef} data-day-jump-scroller>
        <div className={styles.grid} style={{ width: HOUR_GUTTER_WIDTH_PX + totalCanvasWidthPx }}>
          {/* data-autoscroll-sticky-top: see useAutoScroll's top-edge comment. */}
          <div className={styles.headerRow} data-autoscroll-sticky-top>
            <div className={styles.cornerCell} style={{ width: HOUR_GUTTER_WIDTH_PX }} data-day-jump-sticky-left>
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
              <div key={day.getTime()} className={styles.dayGroup} style={{ width: dayGroupWidths[dayIndex] }} data-day-jump-date={day.getTime()}>
                <div className={styles.dayLabel}>
                  {weekdayLabel(day)}, {monthLabel(day)} {day.getDate()}
                </div>
                <div className={styles.roomHeaderRow}>
                  {resources.map((resource, roomIndex) => {
                    const key = dayResourceKey(resource.id, dayIndex);
                    const daySquished = (maxLaneCountByResourceDay.get(key) ?? 1) > 1;
                    const expanded = expandedKeys.has(key);
                    return (
                      <div
                        key={resource.id}
                        className={[
                          styles.roomHeaderCell,
                          roomIndex === resources.length - 1 && dayIndex !== days.length - 1 ? styles.dayBoundary : '',
                        ].join(' ').trim()}
                        style={{ width: resourceWidthsByDay[dayIndex][roomIndex] }}
                        onMouseEnter={() => setHoveredKey(key)}
                        onMouseLeave={() => setHoveredKey((current) => (current === key ? null : current))}
                      >
                        <div className={styles.roomHeaderContent} style={{ width: roomColumnWidthPx }}>
                          {onEditRoom && (
                            <button
                              type="button"
                              className={[
                                styles.editRoomButton,
                                hoveredKey === key ? styles.editRoomButtonVisible : '',
                              ].join(' ').trim()}
                              onClick={() => onEditRoom(resource)}
                              aria-label={`Edit ${resource.title}`}
                              title="Edit room"
                            >
                              <Pencil size={12} />
                            </button>
                          )}
                          <span className={styles.roomHeaderTitle}>{resource.title}</span>
                          {daySquished && (
                            <button
                              type="button"
                              className={[
                                styles.expandButton,
                                styles.cellExpandButton,
                                hoveredKey === key ? styles.cellExpandButtonVisible : '',
                              ].join(' ').trim()}
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
                  const key = dayResourceKey(resource.id, dayIndex);
                  return (
                    <div
                      key={`${day.getTime()}-${resource.id}`}
                      className={styles.roomColumnBg}
                      style={{ left: flatColumnLayout.offsets[flatIndex], width: resourceWidthsByDay[dayIndex][roomIndex], height: dayHeightPx }}
                      onPointerDown={(e) => handleRoomColumnPointerDown(e, resource.id, dayIndex)}
                      onMouseEnter={() => setHoveredKey(key)}
                      onMouseLeave={() => setHoveredKey((current) => (current === key ? null : current))}
                      // Hit-test target for Scheduler.tsx's pending-booking
                      // "staging chip" — see its own handlePendingChipDrop.
                      // Not used for anything else (real event drags are
                      // model-driven, not DOM-hit-tested — see EventBlock's
                      // own doc comment on why).
                      data-pending-drop-resource-id={resource.id}
                      data-pending-drop-day-index={dayIndex}
                      // Exempts a mousedown here from NewEventDrawer.tsx's
                      // own "click outside closes it" guard — see its own
                      // comment on this same attribute.
                      data-scheduler-selectable-bg
                    >
                      {hours.map((hour) => (
                        <div key={hour} className={styles.hourCell} style={{ height: 60 * PX_PER_MINUTE }} />
                      ))}
                      {activeSelection && activeSelection.resourceId === resource.id && activeSelection.dayIndex === dayIndex && (
                        <div
                          className={styles.selectionOverlay}
                          style={{
                            top: Math.min(activeSelection.y1, activeSelection.y2),
                            height: Math.abs(activeSelection.y2 - activeSelection.y1),
                          }}
                        />
                      )}
                      {!activeSelection &&
                        pendingSelection &&
                        pendingSelection.resourceId === resource.id &&
                        isSameDay(day, pendingSelection.start) && (
                          <div
                            className={styles.selectionOverlay}
                            style={{
                              top: dateToX(pendingSelection.start, timeGeometry),
                              height: dateToX(pendingSelection.end, timeGeometry) - dateToX(pendingSelection.start, timeGeometry),
                            }}
                          />
                        )}
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
                const laneWidth = expanded ? roomColumnWidthPx : roomColumnWidthPx / info.laneCount;
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
                    flagged={flaggedEventIds?.has(event.id) ?? false}
                    blocking={blockingEventIds?.has(event.id) ?? false}
                    sameClassType={sameClassEventIds.has(event.id)}
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
                    onRowHoverChange={
                      eventDayIndex === -1
                        ? undefined
                        : (hovering) => {
                            const key = dayResourceKey(event.resourceId, eventDayIndex);
                            setHoveredKey((current) => {
                              if (hovering) return key;
                              return current === key ? null : current;
                            });
                          }
                    }
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
