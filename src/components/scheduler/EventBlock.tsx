import { memo, useCallback, useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent, type RefObject } from 'react';
import { usePointerDrag } from './hooks/usePointerDrag';
import { usePointerResize } from './hooks/usePointerResize';
import { dateToX, durationToWidthPx, xToDate, type TimelineGeometry } from './utils/timeGeometry';
import { addMinutes, formatTimeOfDay, formatTimeRange, isSameDay } from './utils/dateMath';
import { rowIndexAtY, type RowLayout } from './utils/rowLayout';
import { initialsFor } from './utils/initials';
import { colorForInstructor } from './utils/instructorColor';
import type { EventRenderContext, Resource, ResizeEdge, SchedulerEvent, SchedulerProps } from './Scheduler.types';
import styles from './EventBlock.module.css';

const CLICK_MOVE_THRESHOLD_PX = 3;
const MIN_HANDLE_HIT_AREA_PX = 8;

interface PreviewRange {
  start: Date;
  end: Date;
  resourceId: string;
}

export interface EventBlockProps {
  event: SchedulerEvent;
  color: string;
  /** In vertical mode, purely a time-of-day → pixel conversion (dateToX/xToDate ignore which real calendar day a Date falls on when geometry has only one placeholder day — see WeekViewVertical). */
  geometry: TimelineGeometry;
  editable: boolean;
  resources: Resource[];
  /**
   * Cumulative offsets along whichever axis is the "room" axis: one entry per
   * resource in horizontal mode, or one entry per (day, room) pair — flattened
   * day-major, `dayIndex * resources.length + roomIndex` — in vertical mode.
   */
  rowLayout: RowLayout;
  /** Offset/size along the room axis (see `rowLayout`) for this event's own overlap lane — vertical (a Y offset/height) in horizontal mode, horizontal (an X offset/width) in vertical mode. Named for the horizontal case since that's still the default/primary orientation. */
  laneTop: number;
  laneHeight: number;
  /** True when this event is sharing its room+day with other overlapping events (laneCount > 1, i.e. actually squished into a sub-lane) — hides the instructor avatar, since a narrow lane has no comfortable room for both it and the title/time text. */
  squished?: boolean;
  containerRef: RefObject<HTMLElement | null>;
  autoScrollThreshold: number;
  autoScrollSpeed: number;
  /** Shifts the auto-scroll start-edge threshold inward — see useAutoScroll's own doc comment. Only meaningful in horizontal mode, for TimelineView's sticky resource column; vertical mode has no equivalent overlay on its own (vertical) auto-scroll axis. */
  autoScrollStartInset?: number;
  /** 'horizontal' (default) is today's Day/Week/Month layout (time = X, room = Y). 'vertical' is WeekViewVertical's (room+day = X, time = Y) — see `days`. */
  orientation?: 'horizontal' | 'vertical';
  /** The week's dates, day-group order matching `rowLayout`'s flattening — required (and only meaningful) when `orientation` is 'vertical', to recover which real calendar day a room+day column index refers to. */
  days?: Date[];
  /** Whether this event's details drawer is open (double-clicked) — the only thing that shows the "selected" highlight now. */
  selected: boolean;
  /** Fired once a move actually starts moving (past the click threshold) or a resize starts at all — opens the details drawer so its availability overlay is visible for the whole gesture, not just after a double-click. */
  onInteractionStart?: (event: SchedulerEvent) => void;
  renderEvent?: SchedulerProps['renderEvent'];
  onEventClick?: SchedulerProps['onEventClick'];
  onEventDoubleClick?: SchedulerProps['onEventDoubleClick'];
  onEventMove?: SchedulerProps['onEventMove'];
  onEventResizeStart?: SchedulerProps['onEventResizeStart'];
  onEventResize?: SchedulerProps['onEventResize'];
  onEventResizeEnd?: SchedulerProps['onEventResizeEnd'];
}

function EventBlockImpl({
  event,
  color,
  geometry,
  editable,
  resources,
  rowLayout,
  laneTop,
  laneHeight,
  squished = false,
  containerRef,
  autoScrollThreshold,
  autoScrollSpeed,
  autoScrollStartInset = 0,
  orientation = 'horizontal',
  days,
  selected,
  onInteractionStart,
  renderEvent,
  onEventClick,
  onEventDoubleClick,
  onEventMove,
  onEventResizeStart,
  onEventResize,
  onEventResizeEnd,
}: EventBlockProps) {
  const vertical = orientation === 'vertical';
  const [preview, setPreview] = useState<PreviewRange | null>(null);
  const [dragging, setDragging] = useState(false);
  const [hovered, setHovered] = useState(false);
  // The block's actual rendered left/top the instant it's grabbed, plus
  // whatever raw pixel delta the pointer has moved since — this is what
  // makes the dragged block visually stick to the cursor at the exact point
  // it was grabbed, same as any native drag. `preview` above stays the
  // separate, snapped-to-grid semantic target (room row, time slot) used for
  // the eventual onEventMove commit and for conflict/availability checks —
  // it deliberately does NOT drive the on-screen position of an active drag.
  const [dragVisualPos, setDragVisualPos] = useState<{ left: number; top: number } | null>(null);

  const originRef = useRef({ contentX: 0, contentY: 0, startLeft: 0, startTop: 0 });
  const movedRef = useRef(false);
  const suppressClickRef = useRef(false);
  // Mirrors `preview` outside React state so handleMoveEnd can read its
  // latest value synchronously instead of reaching for it from inside a
  // setState updater function — calling a prop callback (onEventMove, which
  // itself calls setState further up the tree) from inside an updater is
  // exactly the "Cannot update a component while rendering a different
  // component" hazard, since updaters can be invoked outside normal commit
  // timing. Only the move path needs this; resize already computes its
  // final range directly (see handleResizeEnd) rather than reading it back
  // out of `preview`.
  const previewRef = useRef<PreviewRange | null>(null);
  const setPreviewAndRef = useCallback((next: PreviewRange | null) => {
    previewRef.current = next;
    setPreview(next);
  }, []);

  const resourceIndex = useMemo(
    () => Math.max(0, resources.findIndex((r) => r.id === event.resourceId)),
    [resources, event.resourceId],
  );

  // Index into `rowLayout` at rest (no drag in progress) — the room index
  // directly in horizontal mode, or the flattened (day, room) index in
  // vertical mode (see `rowLayout`'s own doc comment on EventBlockProps).
  const restFlatIndex = useMemo(() => {
    if (!vertical) return resourceIndex;
    const dayIndex = Math.max(0, (days ?? []).findIndex((d) => isSameDay(d, event.start)));
    return dayIndex * resources.length + resourceIndex;
  }, [vertical, days, event.start, resources.length, resourceIndex]);

  // Mirrors everything the stable drag callbacks below need but which can
  // change render to render, kept fresh via effect (not a direct write
  // during render). usePointerDrag/usePointerResize attach their
  // window-level pointermove/pointerup listeners exactly once, at the
  // instant pointerdown fires — if onStart/onMove/onEnd were plain inline
  // closures (recreated every render, since onMove's own setPreview call
  // re-renders this component on every pointer move mid-drag), the listener
  // that's actually attached stays bound to whichever render happened to be
  // current at drag-start, and its own cleanup call (removeEventListener,
  // keyed off a ref that always points at the *latest* closure) ends up
  // trying to remove a different function than the one that was ever
  // added — that removal silently fails, leaking a stale listener on every
  // single drag/resize.
  const propsRef = useRef({
    event, geometry, resources, rowLayout, laneTop, laneHeight, orientation, days, onInteractionStart, onEventMove,
    onEventResizeStart, onEventResize, onEventResizeEnd,
  });
  useEffect(() => {
    propsRef.current = {
      event, geometry, resources, rowLayout, laneTop, laneHeight, orientation, days, onInteractionStart, onEventMove,
      onEventResizeStart, onEventResize, onEventResizeEnd,
    };
  });

  const handleMoveStart = useCallback((point: { contentX: number; contentY: number }) => {
    const { event, geometry, resources, rowLayout, laneTop, orientation, days } = propsRef.current;
    const timeAxisOrigin = dateToX(event.start, geometry);
    let roomAxisOrigin: number;
    if (orientation === 'vertical') {
      const startRoomIndex = Math.max(0, resources.findIndex((r) => r.id === event.resourceId));
      const startDayIndex = Math.max(0, (days ?? []).findIndex((d) => isSameDay(d, event.start)));
      const flatIndex = startDayIndex * resources.length + startRoomIndex;
      roomAxisOrigin = (rowLayout.offsets[flatIndex] ?? 0) + laneTop;
    } else {
      const startResourceIndex = Math.max(0, resources.findIndex((r) => r.id === event.resourceId));
      roomAxisOrigin = (rowLayout.offsets[startResourceIndex] ?? 0) + laneTop;
    }
    originRef.current = {
      contentX: point.contentX,
      contentY: point.contentY,
      startLeft: orientation === 'vertical' ? roomAxisOrigin : timeAxisOrigin,
      startTop: orientation === 'vertical' ? timeAxisOrigin : roomAxisOrigin,
    };
    movedRef.current = false;
    setDragging(true);
  }, []);

  const handleMoveMove = useCallback(({ contentX, contentY }: { contentX: number; contentY: number }) => {
    const { event, geometry, resources, rowLayout, laneHeight, orientation, days, onInteractionStart } = propsRef.current;
    const origin = originRef.current;
    if (
      Math.abs(contentX - origin.contentX) > CLICK_MOVE_THRESHOLD_PX ||
      Math.abs(contentY - origin.contentY) > CLICK_MOVE_THRESHOLD_PX
    ) {
      if (!movedRef.current) onInteractionStart?.(event); // first frame this is an actual drag, not just a click
      movedRef.current = true;
    }
    const rawDeltaX = contentX - origin.contentX;
    const rawDeltaY = contentY - origin.contentY;
    // The block's on-screen position while dragging: the exact point grabbed
    // stays glued to the cursor (raw pixel delta, both axes, no snapping) —
    // see dragVisualPos's own comment for why this is tracked separately
    // from the semantic (snapped) preview below.
    setDragVisualPos({ left: origin.startLeft + rawDeltaX, top: origin.startTop + rawDeltaY });

    const durationMinutes = (event.end.getTime() - event.start.getTime()) / 60000;

    if (orientation === 'vertical') {
      // Time-of-day comes from whichever axis is "time" here (Y) — xToDate
      // snaps against the day's absolute grid same as horizontal mode (see
      // that branch's comment for why relative-to-origin snapping would be
      // wrong); only its hours/minutes/seconds are meaningful, since
      // `geometry` here has a single placeholder day (see EventBlockProps).
      const timeOfDay = xToDate(origin.startTop + rawDeltaY, geometry);
      // Room+day come from the other axis (X) — a flat day-major column
      // layout (see `rowLayout`'s own doc comment), read via the block's
      // rendered *center* along that axis (same "center, not edge" reasoning
      // as horizontal mode's row lookup below, just on X instead of Y).
      const blockCenterX = origin.startLeft + laneHeight / 2 + rawDeltaX;
      const weekDays = days ?? [];
      const flatCount = weekDays.length * resources.length;
      const flatIndex = Math.max(0, Math.min(flatCount - 1, rowIndexAtY(blockCenterX, rowLayout)));
      const dayIndex = resources.length > 0 ? Math.floor(flatIndex / resources.length) : 0;
      const roomIndex = resources.length > 0 ? flatIndex % resources.length : 0;
      const targetDay = weekDays[dayIndex] ?? event.start;
      const newStart = new Date(
        targetDay.getFullYear(), targetDay.getMonth(), targetDay.getDate(),
        timeOfDay.getHours(), timeOfDay.getMinutes(), timeOfDay.getSeconds(), timeOfDay.getMilliseconds(),
      );
      const newEnd = addMinutes(newStart, durationMinutes);
      setPreviewAndRef({ start: newStart, end: newEnd, resourceId: resources[roomIndex]?.id ?? event.resourceId });
      return;
    }

    // Snapped against the day's absolute grid (xToDate snaps the raw content
    // position itself), not against event.start plus a snapped delta — the
    // latter only snaps relative to wherever the event already happened to
    // sit, so an event that isn't itself exactly grid-aligned (e.g. one
    // reached via a previous relative-snapped drag) could never be dragged
    // onto a clean :00/:15/:30/:45 mark, making it impossible to land it
    // exactly adjacent to another, already grid-aligned event.
    const newStart = xToDate(origin.startLeft + rawDeltaX, geometry);
    const newEnd = addMinutes(newStart, durationMinutes);
    // Row target is derived from how many rows the pointer has moved *relative to
    // where the drag started* (like the horizontal axis), not from the pointer's
    // absolute Y — contentY is measured from the scroll container's top, which
    // includes the sticky header, so an absolute row lookup is off by roughly
    // headerHeight rows and the block snaps to the wrong row. Rows aren't all
    // the same height once one is expanded, so this can't be a simple
    // `round(deltaY / rowHeight)` any more — instead, track the block's own
    // rendered *center* (its top, per dragVisualPos above, plus half its own
    // height), not its top edge or the row's own top — looking up by the top
    // edge picks whichever row the edge has crept into even when the block is
    // still mostly sitting in the row above, which doesn't match "drop it
    // wherever it looks like it's mostly sitting."
    const blockCenterY = origin.startTop + laneHeight / 2 + rawDeltaY;
    const targetRowIndex = Math.max(
      0,
      Math.min(resources.length - 1, rowIndexAtY(blockCenterY, rowLayout)),
    );
    setPreviewAndRef({ start: newStart, end: newEnd, resourceId: resources[targetRowIndex].id });
  }, [setPreviewAndRef]);

  const handleMoveEnd = useCallback(() => {
    const { event, onEventMove } = propsRef.current;
    setDragging(false);
    setDragVisualPos(null);
    const finalPreview = previewRef.current;
    setPreviewAndRef(null);
    if (movedRef.current && finalPreview) {
      suppressClickRef.current = true;
      onEventMove?.(event, finalPreview.resourceId, finalPreview.start, finalPreview.end);
    }
  }, [setPreviewAndRef]);

  const moveDrag = usePointerDrag({
    containerRef,
    autoScrollThreshold,
    autoScrollSpeed,
    autoScrollAxis: vertical ? 'y' : 'x',
    autoScrollStartInset,
    onStart: handleMoveStart,
    onMove: handleMoveMove,
    onEnd: handleMoveEnd,
  });

  const resizeOriginRef = useRef({ contentPos: 0, edgePos: 0 });

  // Resizing only ever changes duration (never day/room) — dateToX/xToDate
  // treat their input purely as a time position regardless of which CSS axis
  // it came from, so the position math itself needs no orientation
  // branching. But in vertical mode `geometry` is a single-*placeholder*-day
  // timeline (see EventBlockProps): xToDate's returned Date always carries
  // that placeholder's day, not the real day this event is actually on, so
  // it has to be swapped back in before use — otherwise a resize on any day
  // other than the placeholder computes a start/end on the WRONG calendar
  // day, which then fails the min-duration comparison against the (correct)
  // event.start/end and silently clamps to a bogus 1-snap-interval sliver.
  const withRealDay = useCallback((date: Date, referenceDay: Date, orientation: 'horizontal' | 'vertical') => {
    if (orientation !== 'vertical') return date;
    return new Date(
      referenceDay.getFullYear(), referenceDay.getMonth(), referenceDay.getDate(),
      date.getHours(), date.getMinutes(), date.getSeconds(), date.getMilliseconds(),
    );
  }, []);

  const computeResizedRange = useCallback((edge: ResizeEdge, contentPos: number): { start: Date; end: Date } => {
    const { event, geometry, orientation } = propsRef.current;
    const minDurationMs = geometry.snapMinutes * 60 * 1000;
    const origin = resizeOriginRef.current;
    // Snapped against the day's absolute grid (same reasoning as the move-drag
    // above), not against event.start/end plus a snapped delta.
    const newEdgePos = origin.edgePos + (contentPos - origin.contentPos);
    if (edge === 'start') {
      let newStart = withRealDay(xToDate(newEdgePos, geometry), event.start, orientation);
      if (newStart.getTime() > event.end.getTime() - minDurationMs) {
        newStart = new Date(event.end.getTime() - minDurationMs);
      }
      return { start: newStart, end: event.end };
    }
    let newEnd = withRealDay(xToDate(newEdgePos, geometry), event.end, orientation);
    if (newEnd.getTime() < event.start.getTime() + minDurationMs) {
      newEnd = new Date(event.start.getTime() + minDurationMs);
    }
    return { start: event.start, end: newEnd };
  }, [withRealDay]);

  const handleResizeStart = useCallback((contentPos: number, edge: ResizeEdge) => {
    const { event, geometry, onInteractionStart, onEventResizeStart } = propsRef.current;
    resizeOriginRef.current = {
      contentPos,
      edgePos: dateToX(edge === 'start' ? event.start : event.end, geometry),
    };
    setDragging(true);
    onInteractionStart?.(event); // resize handles have no click/drag ambiguity, so this fires immediately
    onEventResizeStart?.(event, edge);
  }, []);

  const handleResizeMove = useCallback((contentPos: number, edge: ResizeEdge) => {
    const { event, onEventResize } = propsRef.current;
    const range = computeResizedRange(edge, contentPos);
    setPreview({ start: range.start, end: range.end, resourceId: event.resourceId });
    onEventResize?.(event, range.start, range.end, edge);
  }, [computeResizedRange]);

  const handleResizeEnd = useCallback((contentPos: number, edge: ResizeEdge) => {
    const { event, onEventResizeEnd } = propsRef.current;
    const range = computeResizedRange(edge, contentPos);
    setDragging(false);
    setPreview(null);
    suppressClickRef.current = true;
    onEventResizeEnd?.(event, range.start, range.end, edge);
  }, [computeResizedRange]);

  const resizeDrag = usePointerResize({
    containerRef,
    autoScrollThreshold,
    autoScrollSpeed,
    axis: vertical ? 'y' : 'x',
    autoScrollStartInset,
    onStart: handleResizeStart,
    onMove: handleResizeMove,
    onEnd: handleResizeEnd,
  });

  const handleClick = (e: ReactMouseEvent) => {
    if (suppressClickRef.current) {
      suppressClickRef.current = false;
      return;
    }
    onEventClick?.(event, e);
  };

  const handleDoubleClick = (e: ReactMouseEvent) => {
    onEventDoubleClick?.(event, e);
  };

  const displayStart = preview?.start ?? event.start;
  const displayEnd = preview?.end ?? event.end;
  const displayFlatIndex = useMemo(() => {
    if (!preview) return restFlatIndex;
    const roomIndex = Math.max(0, resources.findIndex((r) => r.id === preview.resourceId));
    if (!vertical) return roomIndex;
    const dayIndex = Math.max(0, (days ?? []).findIndex((d) => isSameDay(d, preview.start)));
    return dayIndex * resources.length + roomIndex;
  }, [preview, resources, vertical, days, restFlatIndex]);

  // "Time axis" and "room axis" here mean whichever CSS axis each currently
  // is — X/left-width in horizontal mode, Y/top-height in vertical mode.
  const timeAxisPos = dateToX(displayStart, geometry);
  const timeAxisSize = durationToWidthPx(displayStart, displayEnd, geometry);
  const roomAxisPos = (rowLayout.offsets[displayFlatIndex] ?? 0) + laneTop;
  const roomAxisSize = laneHeight;

  // While actively being moved, render at the raw cursor-tracked position
  // (dragVisualPos) rather than the snapped semantic one — dragVisualPos is
  // null during a resize (only handleMoveMove sets it), so resizing still
  // falls through to the normal snapped position/width below unaffected.
  const left = dragVisualPos ? dragVisualPos.left : (vertical ? roomAxisPos : timeAxisPos);
  const width = vertical ? roomAxisSize : timeAxisSize;
  const top = dragVisualPos ? dragVisualPos.top : (vertical ? timeAxisPos : roomAxisPos);
  const height = vertical ? timeAxisSize : roomAxisSize;

  const style = {
    left,
    width,
    top,
    height,
    '--event-color': color,
  } as React.CSSProperties;

  const ctx: EventRenderContext = { selected, hovered, dragging };

  const avatar = !squished && (
    <span
      className={[styles.avatar, !vertical ? styles.avatarHorizontal : ''].join(' ').trim()}
      style={{ '--avatar-color': colorForInstructor(event.instructorId) } as React.CSSProperties}
      title={event.instructorName}
    >
      {initialsFor(event.instructorName)}
    </span>
  );

  return (
    <div
      className={[
        styles.event,
        vertical ? styles.vertical : '',
        selected ? styles.selected : '',
        dragging ? styles.dragging : '',
        editable ? '' : styles.locked,
      ].join(' ').trim()}
      style={style}
      data-scheduler-event={event.id}
      onPointerDown={editable ? moveDrag.onPointerDown : undefined}
      onClick={handleClick}
      onDoubleClick={handleDoubleClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      role="button"
      tabIndex={0}
      title={`${event.title} · ${formatTimeOfDay(displayStart)} – ${formatTimeOfDay(displayEnd)}`}
    >
      {editable && (
        <div
          className={vertical ? styles.resizeHandleTop : styles.resizeHandleLeft}
          style={vertical ? { minHeight: MIN_HANDLE_HIT_AREA_PX } : { minWidth: MIN_HANDLE_HIT_AREA_PX }}
          onPointerDown={(e) => resizeDrag.onPointerDown(e, 'start')}
        />
      )}
      {renderEvent ? (
        renderEvent(event, ctx)
      ) : (
        // Avatar as a leading column, title+time stacked to its right in
        // their own shared column — in both orientations, not avatar-then-
        // title on one row with time on a separate row below, which left
        // time's own left edge sitting under the avatar instead of under
        // the title once the avatar moved in front of it. Stacking
        // title/time in one column beside the avatar keeps them aligned
        // regardless of avatar width. Vertical mode's own modifier keeps
        // defaultContent's base padding (its blocks are narrow, not the
        // tight horizontal rows defaultContentHorizontal's reduced padding
        // was tuned for).
        <div
          className={[
            styles.defaultContent,
            vertical ? styles.defaultContentVertical : styles.defaultContentHorizontal,
          ].join(' ')}
        >
          {avatar}
          <div className={[styles.textStack, vertical ? styles.textStackVertical : ''].join(' ').trim()}>
            <div className={styles.title}>{event.title}</div>
            <div className={styles.time}>{formatTimeRange(displayStart, displayEnd)}</div>
          </div>
        </div>
      )}
      {editable && (
        <div
          className={vertical ? styles.resizeHandleBottom : styles.resizeHandleRight}
          style={vertical ? { minHeight: MIN_HANDLE_HIT_AREA_PX } : { minWidth: MIN_HANDLE_HIT_AREA_PX }}
          onPointerDown={(e) => resizeDrag.onPointerDown(e, 'end')}
        />
      )}
    </div>
  );
}

function areEqual(prev: EventBlockProps, next: EventBlockProps): boolean {
  return (
    prev.event === next.event &&
    prev.color === next.color &&
    prev.geometry === next.geometry &&
    prev.editable === next.editable &&
    prev.resources === next.resources &&
    prev.rowLayout === next.rowLayout &&
    prev.laneTop === next.laneTop &&
    prev.laneHeight === next.laneHeight &&
    prev.squished === next.squished &&
    prev.selected === next.selected &&
    prev.onInteractionStart === next.onInteractionStart &&
    prev.renderEvent === next.renderEvent &&
    prev.autoScrollThreshold === next.autoScrollThreshold &&
    prev.autoScrollSpeed === next.autoScrollSpeed &&
    prev.autoScrollStartInset === next.autoScrollStartInset &&
    prev.onEventClick === next.onEventClick &&
    prev.onEventDoubleClick === next.onEventDoubleClick &&
    prev.onEventMove === next.onEventMove &&
    prev.onEventResizeStart === next.onEventResizeStart &&
    prev.onEventResize === next.onEventResize &&
    prev.onEventResizeEnd === next.onEventResizeEnd
  );
}

export const EventBlock = memo(EventBlockImpl, areEqual);
