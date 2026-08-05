import { useEffect, useMemo, type RefObject } from 'react';
import { ChevronDown, ChevronUp, Maximize2, Minimize2 } from 'lucide-react';
import type { TimelineGeometry } from './utils/timeGeometry';
import { isSameDay } from './utils/dateMath';
import { computeOverlapLayout } from './utils/overlapLayout';
import { computeAvailabilityBands } from './utils/availabilityOverlay';
import { computeRowLayout } from './utils/rowLayout';
import { useVirtualRows } from './hooks/useVirtualRows';
import { EventBlock } from './EventBlock';
import { ResourceRow } from './ResourceRow';
import { TimeHeader } from './TimeHeader';
import { CurrentTimeIndicator } from './CurrentTimeIndicator';
import { AvailabilityOverlay } from './AvailabilityOverlay';
import type { InstructorOption, PendingSelection, Resource, SchedulerEvent, SchedulerProps } from './Scheduler.types';
import styles from './TimelineView.module.css';

/** Floor for one slot's width — columns grow to fill the container above this. */
export const MIN_SLOT_WIDTH_PX = 64;
export const ROW_HEIGHT = 90; // 56 * 1.6, rounded
export const RESOURCE_COLUMN_WIDTH = 160;
const ROW_VERTICAL_PADDING = 4;
const OVERSCAN_ROWS = 4;
// A row expanded to fit N overlapping events gives each one this same height
// per lane — matching exactly how tall a single, non-overlapping event
// already renders in a normal collapsed row (ROW_HEIGHT minus the row's own
// vertical padding), so an expanded lane looks identical to an ordinary
// unsquished event rather than some other arbitrary size.
const EXPANDED_LANE_HEIGHT = ROW_HEIGHT - ROW_VERTICAL_PADDING * 2;

export interface TimelineViewProps {
  resources: Resource[];
  events: SchedulerEvent[];
  instructors: InstructorOption[];
  /** The event currently open in the details drawer (double-clicked) — its move-target feasibility is highlighted across all rooms. Null hides the overlay. */
  highlightEvent: SchedulerEvent | null;
  /** A drag-select awaiting the "new event" drawer — kept highlighted in its own room's row until that drawer closes. */
  pendingSelection: PendingSelection | null;
  geometry: TimelineGeometry;
  editable: boolean;
  eventColors: Map<string, string>;
  autoScrollThreshold: number;
  autoScrollSpeed: number;
  /** The event whose details drawer is open (double-clicked) — the only thing that gets the "selected" highlight now, see Scheduler.tsx. */
  selectedEventId: string | null;
  /** Opens the details drawer for the event being moved/resized — see EventBlock's onInteractionStart. */
  onEventInteractionStart?: (event: SchedulerEvent) => void;
  /** Class types / instructors unchecked in the drawer — hidden from the rendered grid only, not from availability/conflict checks (those still need the true full picture). */
  hiddenClassTypes: Set<string>;
  hiddenInstructorIds: Set<number>;
  /** Rooms manually expanded to a taller row so every overlapping event gets its own full-height lane instead of being squished — see EXPANDED_LANE_HEIGHT. */
  expandedResourceIds: Set<string>;
  onToggleResourceExpanded: (resourceId: string) => void;
  renderEvent?: SchedulerProps['renderEvent'];
  onEventClick?: SchedulerProps['onEventClick'];
  onEventDoubleClick?: SchedulerProps['onEventDoubleClick'];
  onEventMove?: SchedulerProps['onEventMove'];
  onEventResizeStart?: SchedulerProps['onEventResizeStart'];
  onEventResize?: SchedulerProps['onEventResize'];
  onEventResizeEnd?: SchedulerProps['onEventResizeEnd'];
  onDateClick?: SchedulerProps['onDateClick'];
  onSelection?: SchedulerProps['onSelection'];
  scrollContainerRef: RefObject<HTMLDivElement | null>;
  /** Event ids that render normally but can't be dragged/resized — used by MonthMoveConflictModal's reused mini grid, where every *real* booking is a read-only backdrop and only its synthetic "pending placement" block is interactive. Unused (and harmless) for the real Day/Week view. */
  nonInteractiveEventIds?: Set<string>;
  /** Suppresses ResourceRow's drag-to-select-a-new-event affordance without otherwise touching `editable` — same reasoning as nonInteractiveEventIds above. */
  disableRowSelection?: boolean;
}

/**
 * Resource timeline shared by the Day and Week views: resources are rows,
 * time runs horizontally across `days` (1 day, or 7 laid end-to-end for a
 * week — which is what makes dragging "across days" a simple horizontal drag).
 */
export function TimelineView({
  resources,
  events,
  instructors,
  highlightEvent,
  pendingSelection,
  geometry,
  editable,
  eventColors,
  autoScrollThreshold,
  autoScrollSpeed,
  selectedEventId,
  onEventInteractionStart,
  hiddenClassTypes,
  hiddenInstructorIds,
  expandedResourceIds,
  onToggleResourceExpanded,
  renderEvent,
  onEventClick,
  onEventDoubleClick,
  onEventMove,
  onEventResizeStart,
  onEventResize,
  onEventResizeEnd,
  onDateClick,
  onSelection,
  scrollContainerRef,
  nonInteractiveEventIds,
  disableRowSelection,
}: TimelineViewProps) {
  // Events are single-day (this timeline never spans midnight — see
  // timeGeometry.ts), so only the ones whose start date matches one of the
  // currently displayed days belong here. Without this, every event ever
  // created would render on every day/week you navigate to: dateToX() clamps
  // an out-of-range date into the nearest visible day column rather than the
  // event being hidden, which looks exactly like a recurring event.
  const visibleEvents = useMemo(
    () =>
      events.filter(
        (event) =>
          geometry.days.some((day) => isSameDay(day, event.start)) &&
          !(event.type && hiddenClassTypes.has(event.type)) &&
          !hiddenInstructorIds.has(event.instructorId),
      ),
    [events, geometry.days, hiddenClassTypes, hiddenInstructorIds],
  );

  const eventsByResource = useMemo(() => {
    const map = new Map<string, SchedulerEvent[]>();
    for (const event of visibleEvents) {
      const list = map.get(event.resourceId);
      if (list) list.push(event);
      else map.set(event.resourceId, [event]);
    }
    return map;
  }, [visibleEvents]);

  const availabilityBands = useMemo(() => {
    if (!highlightEvent) return [];
    const instructor = instructors.find((i) => i.id === highlightEvent.instructorId);
    if (!instructor) return [];
    return computeAvailabilityBands(highlightEvent, instructor, resources, events, geometry.days, geometry.dayStartHour, geometry.dayEndHour);
  }, [highlightEvent, instructors, resources, events, geometry.days, geometry.dayStartHour, geometry.dayEndHour]);

  // Per-event lane assignment, plus the busiest cluster's lane count per
  // resource (maxLaneCountByResource) — the latter decides whether a room
  // even has anything worth expanding, and how tall an expanded row needs to
  // be to give every lane its own full-height slot.
  const { laneLookup, maxLaneCountByResource } = useMemo(() => {
    const laneLookup = new Map<string, { lane: number; laneCount: number }>();
    const maxLaneCountByResource = new Map<string, number>();
    for (const [resourceId, resourceEvents] of eventsByResource) {
      const layout = computeOverlapLayout(
        resourceEvents.map((e) => ({ id: e.id, startValue: e.start.getTime(), endValue: e.end.getTime() })),
      );
      let maxLaneCount = 1;
      for (const [id, laneInfo] of layout) {
        laneLookup.set(id, laneInfo);
        maxLaneCount = Math.max(maxLaneCount, laneInfo.laneCount);
      }
      maxLaneCountByResource.set(resourceId, maxLaneCount);
    }
    return { laneLookup, maxLaneCountByResource };
  }, [eventsByResource]);

  const rowLayout = useMemo(
    () =>
      computeRowLayout(
        resources.map((resource) => {
          const maxLaneCount = maxLaneCountByResource.get(resource.id) ?? 1;
          return expandedResourceIds.has(resource.id) && maxLaneCount > 1
            ? maxLaneCount * EXPANDED_LANE_HEIGHT + ROW_VERTICAL_PADDING * 2
            : ROW_HEIGHT;
        }),
      ),
    [resources, maxLaneCountByResource, expandedResourceIds],
  );

  // Rooms that actually have overlapping events, i.e. the ones the per-row
  // button even appears on — "expand all" only ever expands these, and
  // "collapse all" is available whenever any of them currently is expanded.
  const expandableResourceIds = useMemo(
    () => resources.filter((r) => (maxLaneCountByResource.get(r.id) ?? 1) > 1).map((r) => r.id),
    [resources, maxLaneCountByResource],
  );
  const allExpanded =
    expandableResourceIds.length > 0 && expandableResourceIds.every((id) => expandedResourceIds.has(id));

  function handleToggleAllExpanded() {
    // Reuses the single-row toggle rather than a separate bulk setter —
    // onToggleResourceExpanded's functional state update means calling it
    // once per id here still applies every toggle correctly in one batch.
    if (allExpanded) {
      for (const id of expandedResourceIds) onToggleResourceExpanded(id);
    } else {
      for (const id of expandableResourceIds) {
        if (!expandedResourceIds.has(id)) onToggleResourceExpanded(id);
      }
    }
  }

  const { startIndex, endIndex, topSpacerHeight, bottomSpacerHeight } = useVirtualRows(
    scrollContainerRef,
    rowLayout,
    OVERSCAN_ROWS,
  );

  const visibleResources = resources.slice(startIndex, endIndex);
  const canvasHeight = rowLayout.totalHeight;

  // A plain mouse wheel only ever reports vertical delta, but the timeline's
  // dominant scroll axis is horizontal (time runs sideways). When there's
  // little/no vertical overflow to consume that delta (few resource rows),
  // the wheel would otherwise do nothing — redirect it to horizontal panning
  // instead. React's own onWheel is passive by default (preventDefault would
  // throw), so this needs a real, non-passive DOM listener.
  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;
    function handleWheel(e: WheelEvent) {
      if (!container || e.deltaY === 0 || container.scrollHeight > container.clientHeight) return;
      e.preventDefault();
      container.scrollLeft += e.deltaY;
    }
    container.addEventListener('wheel', handleWheel, { passive: false });
    return () => container.removeEventListener('wheel', handleWheel);
  }, [scrollContainerRef]);

  return (
    <div
      className={styles.scrollContainer}
      ref={scrollContainerRef}
      tabIndex={0}
      onMouseEnter={(e) => e.currentTarget.focus({ preventScroll: true })}
    >
      <div className={styles.grid} style={{ width: RESOURCE_COLUMN_WIDTH + geometry.totalWidthPx }}>
        <div className={styles.headerRow}>
          <div className={styles.cornerCell} style={{ width: RESOURCE_COLUMN_WIDTH }}>
            <span>Rooms</span>
            {expandableResourceIds.length > 0 && (
              <button
                type="button"
                className={[styles.expandButton, styles.expandAllButton].join(' ')}
                onClick={handleToggleAllExpanded}
                aria-pressed={allExpanded}
                aria-label={allExpanded ? 'Collapse all rooms' : 'Expand all rooms with overlapping events'}
                title={allExpanded ? 'Collapse all rooms' : 'Expand all rooms with overlapping events'}
              >
                {allExpanded ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
              </button>
            )}
          </div>
          <TimeHeader geometry={geometry} onDateClick={onDateClick} />
        </div>

        <div className={styles.bodyRow}>
          <div className={styles.resourceColumn} style={{ width: RESOURCE_COLUMN_WIDTH }}>
            <div style={{ height: topSpacerHeight }} />
            {visibleResources.map((resource, i) => {
              const maxLaneCount = maxLaneCountByResource.get(resource.id) ?? 1;
              const expanded = expandedResourceIds.has(resource.id);
              return (
                <div
                  key={resource.id}
                  className={styles.resourceCell}
                  style={{ height: rowLayout.heights[startIndex + i] }}
                >
                  <span className={styles.resourceTitle}>{resource.title}</span>
                  {maxLaneCount > 1 && (
                    <button
                      type="button"
                      className={[styles.expandButton, styles.rowExpandButton].join(' ')}
                      onClick={() => onToggleResourceExpanded(resource.id)}
                      aria-pressed={expanded}
                      aria-label={expanded ? `Collapse ${resource.title}` : `Expand ${resource.title} to fit overlapping events`}
                      title={expanded ? 'Collapse row' : 'Expand row to fit overlapping events'}
                    >
                      {expanded ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
                    </button>
                  )}
                </div>
              );
            })}
            <div style={{ height: bottomSpacerHeight }} />
          </div>

          <div className={styles.canvas} style={{ width: geometry.totalWidthPx, height: canvasHeight }}>
            {visibleResources.map((resource, i) => (
              <ResourceRow
                key={resource.id}
                resourceId={resource.id}
                top={rowLayout.offsets[startIndex + i]}
                height={rowLayout.heights[startIndex + i]}
                geometry={geometry}
                resourceColumnWidth={RESOURCE_COLUMN_WIDTH}
                containerRef={scrollContainerRef}
                autoScrollThreshold={autoScrollThreshold}
                autoScrollSpeed={autoScrollSpeed}
                editable={editable && !disableRowSelection}
                onSelection={onSelection}
                onDateClick={onDateClick}
                persistentSelection={pendingSelection?.resourceId === resource.id ? pendingSelection : null}
              />
            ))}

            <CurrentTimeIndicator geometry={geometry} height={canvasHeight} />

            <AvailabilityOverlay bands={availabilityBands} resources={resources} geometry={geometry} rowLayout={rowLayout} />

            {visibleResources.flatMap((resource) => {
              const resourceEvents = eventsByResource.get(resource.id) ?? [];
              const expanded = expandedResourceIds.has(resource.id) && (maxLaneCountByResource.get(resource.id) ?? 1) > 1;
              return resourceEvents.map((event) => {
                const laneInfo = laneLookup.get(event.id) ?? { lane: 0, laneCount: 1 };
                const laneHeight = expanded ? EXPANDED_LANE_HEIGHT : (ROW_HEIGHT - ROW_VERTICAL_PADDING * 2) / laneInfo.laneCount;
                const laneTop = ROW_VERTICAL_PADDING + laneInfo.lane * laneHeight;
                return (
                  <EventBlock
                    key={event.id}
                    event={event}
                    color={eventColors.get(event.id) ?? 'var(--sched-accent)'}
                    geometry={geometry}
                    editable={editable && !(nonInteractiveEventIds?.has(event.id) ?? false)}
                    resources={resources}
                    rowLayout={rowLayout}
                    laneTop={laneTop}
                    laneHeight={laneHeight}
                    squished={laneInfo.laneCount > 1 && !expanded}
                    containerRef={scrollContainerRef}
                    autoScrollThreshold={autoScrollThreshold}
                    autoScrollSpeed={autoScrollSpeed}
                    autoScrollStartInset={RESOURCE_COLUMN_WIDTH}
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
              });
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
