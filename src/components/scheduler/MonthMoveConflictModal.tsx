import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, GripVertical, X } from 'lucide-react';
import { TimelineView, MIN_SLOT_WIDTH_PX, RESOURCE_COLUMN_WIDTH } from './TimelineView';
import { useElementWidth } from './hooks/useElementWidth';
import { usePendingChipDrag } from './hooks/usePendingChipDrag';
import { createTimelineGeometry, xToDate } from './utils/timeGeometry';
import { findConflicts } from './utils/conflict';
import { findDropCellAt } from './utils/dropTarget';
import { isSameDay, startOfDay } from './utils/dateMath';
import type { InstructorOption, PendingMonthMove, Resource, SchedulerEvent } from './Scheduler.types';
import styles from './MonthMoveConflictModal.module.css';

const EMPTY_CLASS_TYPES = new Set<string>();
const EMPTY_INSTRUCTOR_IDS = new Set<number>();
const EMPTY_EVENT_IDS = new Set<string>();

export interface MonthMoveConflictModalProps {
  pendingMove: PendingMonthMove | null;
  resources: Resource[];
  instructors: InstructorOption[];
  events: SchedulerEvent[];
  /** The calendar's own per-event colors (Scheduler.tsx's computeEventColors) — so every booking looks exactly like it does on the regular calendar. */
  eventColors: Map<string, string>;
  dayStartHour: number;
  dayEndHour: number;
  slotMinutes: number;
  snapMinutes: number;
  autoScrollThreshold: number;
  autoScrollSpeed: number;
  onCancel: () => void;
  onConfirm: (resourceId: string, start: Date, end: Date) => void;
  /** Moves one of the day's OTHER, already-booked classes. Staged inside the modal like the main class — only called (once per moved class, before onConfirm) when the user confirms; Cancel discards them. */
  onMoveOtherEvent?: (event: SchedulerEvent, newResourceId: string, newStart: Date, newEnd: Date) => void;
  /** 'move' (default): an existing event dragged to a conflicting day. 'place': a Classes Bin class dropped onto a Month day (see Scheduler.tsx's handleUnplacedChipDrop) — same pick-a-room-and-time grid, just worded as placing rather than moving. */
  mode?: 'move' | 'place';
}

/**
 * Opened when a Month-view drag-to-a-different-day lands on a conflict (see
 * MonthView's onEventMoveConflict), or a Classes Bin class is dropped on a
 * Month day (mode 'place') — laid out like the View day modal: the target
 * day's real bookings in their regular calendar colors (movable, but staged
 * like the class itself — applied on Confirm, discarded on Cancel; see
 * onMoveOtherEvent), and the
 * class itself floating as a chip over the header until the user drags it
 * into a room/time (no default placement). Once placed it stays in the
 * pending style and can be dragged again to adjust, then Confirm (enabled
 * once placed — deliberate double-booking is allowed) or Cancel. The
 * instructor-availability overlay follows Day view's rule: only for
 * whichever class is highlighted.
 */
export function MonthMoveConflictModal({
  pendingMove,
  resources,
  instructors,
  events,
  eventColors,
  dayStartHour,
  dayEndHour,
  slotMinutes,
  snapMinutes,
  autoScrollThreshold,
  autoScrollSpeed,
  onCancel,
  onConfirm,
  onMoveOtherEvent,
  mode = 'move',
}: MonthMoveConflictModalProps) {
  useEffect(() => {
    if (!pendingMove) return;
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onCancel();
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [pendingMove, onCancel]);

  if (!pendingMove) return null;

  return (
    // data-month-move-dialog: same reasoning as InstructorViewDialog's
    // data-instructor-dialog — this renders as a sibling, not a descendant,
    // of EventPopover/NewEventDrawer, so their own click-outside listeners
    // need to recognize a click in here as "not actually outside".
    <div className={styles.backdrop} data-month-move-dialog onClick={onCancel}>
      <div
        className={styles.card}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={mode === 'place' ? 'Place class' : 'Resolve scheduling conflict'}
      >
        {/* Keyed so a fresh drag proposal (even onto the same event again)
            always resets the in-progress candidate via remount. */}
        <MonthMoveConflictContent
          key={`${pendingMove.event.id}-${pendingMove.newStart.getTime()}`}
          pendingMove={pendingMove}
          resources={resources}
          instructors={instructors}
          events={events}
          eventColors={eventColors}
          dayStartHour={dayStartHour}
          dayEndHour={dayEndHour}
          slotMinutes={slotMinutes}
          snapMinutes={snapMinutes}
          autoScrollThreshold={autoScrollThreshold}
          autoScrollSpeed={autoScrollSpeed}
          onCancel={onCancel}
          onConfirm={onConfirm}
          onMoveOtherEvent={onMoveOtherEvent}
          mode={mode}
        />
      </div>
    </div>
  );
}

interface Candidate {
  resourceId: string;
  start: Date;
  end: Date;
}

function MonthMoveConflictContent({
  pendingMove,
  resources,
  instructors,
  events,
  eventColors,
  dayStartHour,
  dayEndHour,
  slotMinutes,
  snapMinutes,
  autoScrollThreshold,
  autoScrollSpeed,
  onCancel,
  onConfirm,
  onMoveOtherEvent,
  mode,
}: MonthMoveConflictModalProps & { pendingMove: PendingMonthMove }) {
  const { event, newStart, newEnd } = pendingMove;
  const durationMs = newEnd.getTime() - newStart.getTime();
  // No default placement: starts null, with the class floating as a chip
  // over the header (see FloatingPlacementChip) until the user drags it
  // into a room/time — a guessed spot was easy to confirm by accident.
  const [candidate, setCandidate] = useState<Candidate | null>(null);
  // Same rule as the regular Day/Week view: whichever class is highlighted —
  // being dragged (the chip, or any block), or clicked — gets the selected
  // style and its instructor's availability overlay; a click on empty grid
  // space clears it. `event.id` covers the class being placed, whether it's
  // still a chip or already a block.
  const [highlightedId, setHighlightedId] = useState<string | null>(null);
  // Moves of the day's OTHER classes, by event id — held here (not applied)
  // until Confirm, so Cancel leaves the real schedule exactly as it was.
  const [stagedMoves, setStagedMoves] = useState<ReadonlyMap<string, Candidate>>(new Map());
  // `events` as they'd be with every staged move applied — what the grid
  // shows and the conflict warning checks against.
  const effectiveEvents = useMemo(
    () =>
      stagedMoves.size === 0
        ? events
        : events.map((e) => {
            const move = stagedMoves.get(e.id);
            return move ? { ...e, resourceId: move.resourceId, start: move.start, end: move.end } : e;
          }),
    [events, stagedMoves],
  );
  const [expandedResourceIds, setExpandedResourceIds] = useState<Set<string>>(new Set());

  function toggleExpanded(id: string) {
    setExpandedResourceIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  // Measured on .gridWrapper itself (always rendered), not on TimelineView's
  // own internal scroll container — that one's ref only gets attached once
  // TimelineView actually mounts, which would be a chicken-and-egg problem
  // for gating its very first render on a real (non-zero) width measurement.
  const gridWrapperRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const gridWrapperWidth = useElementWidth(gridWrapperRef);

  // The target day, midnight-normalized — always the day that was dropped
  // onto (`newStart`), whether or not anything's been placed yet. Must be
  // midnight-normalized: xToDate() rebuilds a dropped date via
  // addMinutes(days[dayIndex], ...), plain millisecond arithmetic (see
  // dateMath.ts), so a non-midnight day here would add a spurious offset to
  // every dragged position.
  const targetDay = useMemo(() => startOfDay(newStart), [newStart]);

  const geometry = useMemo(() => {
    const slotsPerDay = ((dayEndHour - dayStartHour) * 60) / slotMinutes;
    const availableWidth = Math.max(0, gridWrapperWidth - RESOURCE_COLUMN_WIDTH);
    const slotWidthPx = Math.max(MIN_SLOT_WIDTH_PX, Math.floor(availableWidth / slotsPerDay));
    return createTimelineGeometry({
      days: [targetDay],
      slotMinutes,
      snapMinutes,
      slotWidthPx,
      dayStartHour,
      dayEndHour,
    });
  }, [targetDay, gridWrapperWidth, slotMinutes, snapMinutes, dayStartHour, dayEndHour]);

  // Every other real booking on the target day — read-only backdrop. Never
  // includes `event` itself: it isn't really on this day until Confirm, and
  // the synthetic pending block below (same id) stands in for it instead —
  // this filter is what keeps that substitution from double-rendering.
  const dayEvents = useMemo(
    () => effectiveEvents.filter((e) => e.id !== event.id && isSameDay(e.start, targetDay)),
    [effectiveEvents, event.id, targetDay],
  );

  // `pending: true` keeps it in the pending (blue, dotted) style until
  // Place/Confirm — see .gridWrapper [data-pending] in the stylesheet.
  const pendingEvent: SchedulerEvent | null = useMemo(
    () => (candidate ? { ...event, pending: true, resourceId: candidate.resourceId, start: candidate.start, end: candidate.end } : null),
    [event, candidate],
  );

  // While still a chip, the overlay is dated onto the target day so it can
  // guide where to drop it.
  const overlayEvent: SchedulerEvent | null = useMemo(() => {
    if (highlightedId === null) return null;
    if (highlightedId === event.id) return pendingEvent ?? { ...event, start: newStart, end: newEnd };
    return dayEvents.find((e) => e.id === highlightedId) ?? null;
  }, [highlightedId, pendingEvent, event, newStart, newEnd, dayEvents]);

  // A short warning beside the title once placed — never gates Confirm
  // (deliberate double-booking is allowed). Checked against the staged
  // events, so moving another class out of the way clears it right away.
  const conflictWarning = useMemo(() => {
    if (!candidate) return null;
    const { roomConflict, instructorConflict } = findConflicts(effectiveEvents, {
      resourceId: candidate.resourceId,
      instructorId: event.instructorId,
      start: candidate.start,
      end: candidate.end,
      excludeEventId: event.id,
    });
    if (roomConflict) return `Room already booked for ${roomConflict.title}`;
    if (instructorConflict) {
      const room = resources.find((r) => r.id === instructorConflict.resourceId)?.title ?? 'another room';
      return `${event.instructorName} is also teaching ${instructorConflict.title} in ${room} at this time`;
    }
    return null;
  }, [candidate, effectiveEvents, event.id, event.instructorId, event.instructorName, resources]);

  const modalEvents = useMemo(() => (pendingEvent ? [...dayEvents, pendingEvent] : dayEvents), [dayEvents, pendingEvent]);

  // Same hit-test convention Scheduler.tsx's own chip drops use (ResourceRow
  // cells carry data-pending-drop-resource-id), scoped to THIS modal's grid
  // so the page's own Day/Week grid behind the backdrop can never match.
  function handleChipDrop(clientX: number, clientY: number) {
    const cell = findDropCellAt(clientX, clientY, gridWrapperRef.current);
    if (!cell) return; // missed the grid — chip just snaps back
    const start = xToDate(clientX - cell.getBoundingClientRect().left, geometry);
    setCandidate({ resourceId: cell.dataset.pendingDropResourceId as string, start, end: new Date(start.getTime() + durationMs) });
  }

  return (
    <>
      <div className={styles.header}>
        <div className={styles.titleRow}>
          <h2 className={styles.title}>{event.title}</h2>
          {conflictWarning && (
            <span className={styles.conflictWarning} role="status">
              <AlertTriangle size={14} strokeWidth={2.25} aria-hidden="true" />
              {conflictWarning}
            </span>
          )}
        </div>
        {!candidate && (
          <FloatingPlacementChip
            title={event.title}
            durationMinutes={Math.round(durationMs / 60000)}
            onDrop={handleChipDrop}
            onDragStateChange={(dragging) => setHighlightedId(dragging ? event.id : null)}
          />
        )}
        <button type="button" className={styles.closeButton} onClick={onCancel} aria-label={mode === 'place' ? 'Cancel placing' : 'Cancel move'}>
          <X size={20} />
        </button>
      </div>

      <div
        className={styles.gridWrapper}
        ref={gridWrapperRef}
        // A press on empty grid space un-highlights, same as Day/Week view.
        onPointerDown={(e) => {
          if (!(e.target as HTMLElement).closest('[data-scheduler-event]')) setHighlightedId(null);
        }}
      >
        {/* Gated on a real (post-layout) width measurement rather than
            mounting immediately at width 0 — TimelineView's geometry is a
            function of the measured width, and mounting it against a
            momentarily-wrong (too-narrow) geometry, then rescaling out from
            under an in-progress drag a frame later, is exactly the kind of
            thing that would make a dragged block jump to an unexpected spot. */}
        {gridWrapperWidth > 0 && (
          <TimelineView
            resources={resources}
            events={modalEvents}
            instructors={instructors}
            highlightEvent={overlayEvent}
            pendingSelection={null}
            geometry={geometry}
            editable
            eventColors={eventColors}
            // Same edge-detection auto-scroll as Day/Week (threaded through
            // from Scheduler's own configured values), so dragging near the
            // mini grid's edge scrolls it too.
            autoScrollThreshold={autoScrollThreshold}
            autoScrollSpeed={autoScrollSpeed}
            selectedEventId={highlightedId}
            sameClassEventIds={EMPTY_EVENT_IDS}
            hiddenClassTypes={EMPTY_CLASS_TYPES}
            hiddenInstructorIds={EMPTY_INSTRUCTOR_IDS}
            expandedResourceIds={expandedResourceIds}
            onToggleResourceExpanded={toggleExpanded}
            disableRowSelection
            onEventInteractionStart={(started) => setHighlightedId(started.id)}
            onEventClick={(clicked) => setHighlightedId((current) => (current === clicked.id ? null : clicked.id))}
            onEventMove={(movedEvent, newResourceId, movedStart, movedEnd) => {
              if (movedEvent.id === event.id) {
                setCandidate({ resourceId: newResourceId, start: movedStart, end: movedEnd });
              } else {
                setStagedMoves((current) => new Map(current).set(movedEvent.id, { resourceId: newResourceId, start: movedStart, end: movedEnd }));
              }
            }}
            scrollContainerRef={scrollContainerRef}
          />
        )}
      </div>

      <div className={styles.footer}>
        <button type="button" className={styles.cancelButton} onClick={onCancel}>
          Cancel
        </button>
        <button
          type="button"
          className={styles.confirmButton}
          disabled={!candidate}
          onClick={() => {
            if (!candidate) return;
            // Staged moves first, against the ORIGINAL events (what the host
            // knows about), then the class itself.
            for (const [id, move] of stagedMoves) {
              const original = events.find((e) => e.id === id);
              if (original) onMoveOtherEvent?.(original, move.resourceId, move.start, move.end);
            }
            onConfirm(candidate.resourceId, candidate.start, candidate.end);
          }}
        >
          {mode === 'place' ? 'Place class' : 'Confirm move'}
        </button>
      </div>
    </>
  );
}

/**
 * The not-yet-placed class, floating over the modal's header — dragged into
 * the grid below to give it a room and time (see handleChipDrop). Same
 * raw-cursor-following mechanics as PendingBookingChip (usePendingChipDrag),
 * styled in the theme accent with a dotted outline.
 */
function FloatingPlacementChip({
  title,
  durationMinutes,
  onDrop,
  onDragStateChange,
}: {
  title: string;
  durationMinutes: number;
  onDrop: (clientX: number, clientY: number) => void;
  /** True while being dragged — drives the availability overlay (see `highlighted`). */
  onDragStateChange: (dragging: boolean) => void;
}) {
  const { dragOffset, handlePointerDown, handlePointerMove, handlePointerUp } = usePendingChipDrag(onDrop);
  const dragging = dragOffset !== null;
  useEffect(() => {
    onDragStateChange(dragging);
  }, [dragging, onDragStateChange]);
  return (
    <div
      className={styles.floatingChip}
      // Keeps the at-rest translateX(-50%) centering as part of the drag
      // transform (an inline transform fully replaces the stylesheet's), and
      // goes pointer-events: none mid-drag so handleChipDrop's own
      // elementFromPoint finds the grid cell underneath, not this chip — see
      // PendingBookingChip's own comments for the full reasoning on both.
      style={
        dragOffset
          ? { transform: `translate(calc(-50% + ${dragOffset.x}px), ${dragOffset.y}px)`, transition: 'none', pointerEvents: 'none' }
          : undefined
      }
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      role="button"
      aria-label={`Drag ${title} into a room and time slot`}
    >
      <GripVertical size={14} strokeWidth={2.25} />
      <span className={styles.floatingChipText}>
        <span className={styles.floatingChipTitle}>{title}</span>
        <span className={styles.floatingChipHint}>{durationMinutes} min — drag into a room &amp; time</span>
      </span>
    </div>
  );
}
