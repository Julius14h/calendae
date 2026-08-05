import { useEffect, useMemo, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { TimelineView, MIN_SLOT_WIDTH_PX, RESOURCE_COLUMN_WIDTH } from './TimelineView';
import { useElementWidth } from './hooks/useElementWidth';
import { createTimelineGeometry } from './utils/timeGeometry';
import { findConflicts } from './utils/conflict';
import { formatTimeOfDay, isSameDay, monthLabel, startOfDay, weekdayLabel } from './utils/dateMath';
import type { InstructorOption, PendingMonthMove, Resource, SchedulerEvent } from './Scheduler.types';
import styles from './MonthMoveConflictModal.module.css';

// Reuses the app's existing "conflict"/"primary interactive" colors rather
// than inventing new ones — #ef4444 is already the destructive/conflict
// color everywhere else (delete buttons, danger menu items); the pending
// placement uses the theme accent, same as any other selected/primary UI.
const CONFLICT_COLOR = '#ef4444';
const PENDING_COLOR = 'var(--sched-accent)';
// The instructor's *other* booking, when it's the only reason the slot still
// conflicts and it isn't already obvious (it's in a different room, so it
// never visually overlaps the pending block) — a distinct color from the
// uniform "Booked" red so it's identifiable as the specific cause, not just
// another unrelated booking.
const INSTRUCTOR_CONFLICT_COLOR = '#f59e0b';
const EMPTY_CLASS_TYPES = new Set<string>();
const EMPTY_INSTRUCTOR_IDS = new Set<number>();

export interface MonthMoveConflictModalProps {
  pendingMove: PendingMonthMove | null;
  resources: Resource[];
  instructors: InstructorOption[];
  events: SchedulerEvent[];
  dayStartHour: number;
  dayEndHour: number;
  slotMinutes: number;
  snapMinutes: number;
  autoScrollThreshold: number;
  autoScrollSpeed: number;
  onCancel: () => void;
  onConfirm: (resourceId: string, start: Date, end: Date) => void;
}

/**
 * Opened when a Month-view drag-to-a-different-day lands on a conflict (see
 * MonthView's onEventMoveConflict) — a "snapshot of Day view" for the target
 * date: every real booking on it shown read-only in red, the tentative
 * placement shown as its own draggable block the user can reposition, then
 * Confirm (always enabled — deliberate double-booking is allowed) or Cancel.
 */
export function MonthMoveConflictModal({
  pendingMove,
  resources,
  instructors,
  events,
  dayStartHour,
  dayEndHour,
  slotMinutes,
  snapMinutes,
  autoScrollThreshold,
  autoScrollSpeed,
  onCancel,
  onConfirm,
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
    // of EventDetailsDrawer/NewEventDrawer, so their own click-outside
    // listeners need to recognize a click in here as "not actually outside".
    <div className={styles.backdrop} data-month-move-dialog onClick={onCancel}>
      <div
        className={styles.card}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Resolve scheduling conflict"
      >
        {/* Keyed so a fresh drag proposal (even onto the same event again)
            always resets the in-progress candidate via remount. */}
        <MonthMoveConflictContent
          key={`${pendingMove.event.id}-${pendingMove.newStart.getTime()}`}
          pendingMove={pendingMove}
          resources={resources}
          instructors={instructors}
          events={events}
          dayStartHour={dayStartHour}
          dayEndHour={dayEndHour}
          slotMinutes={slotMinutes}
          snapMinutes={snapMinutes}
          autoScrollThreshold={autoScrollThreshold}
          autoScrollSpeed={autoScrollSpeed}
          onCancel={onCancel}
          onConfirm={onConfirm}
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
  dayStartHour,
  dayEndHour,
  slotMinutes,
  snapMinutes,
  autoScrollThreshold,
  autoScrollSpeed,
  onCancel,
  onConfirm,
}: MonthMoveConflictModalProps & { pendingMove: PendingMonthMove }) {
  const { event, newStart, newEnd } = pendingMove;
  const [candidate, setCandidate] = useState<Candidate>({ resourceId: event.resourceId, start: newStart, end: newEnd });
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

  const geometry = useMemo(() => {
    const slotsPerDay = ((dayEndHour - dayStartHour) * 60) / slotMinutes;
    const availableWidth = Math.max(0, gridWrapperWidth - RESOURCE_COLUMN_WIDTH);
    const slotWidthPx = Math.max(MIN_SLOT_WIDTH_PX, Math.floor(availableWidth / slotsPerDay));
    return createTimelineGeometry({
      // Midnight-normalized, not candidate.start itself — xToDate() rebuilds
      // a dropped date via addMinutes(days[dayIndex], ...), which is plain
      // millisecond arithmetic (see dateMath.ts), not a calendar-field reset.
      // Day/Week's own geometry always gets midnight-normalized days (via
      // startOfDay()/eachDayOfRange()), so that arithmetic silently assumes
      // it. Passing candidate.start (e.g. 9:00 AM) here instead added a
      // second, spurious 9:00-AM-plus-dayStartHour offset to every dragged
      // position — small pixel deltas produced multi-hour jumps, and a drag
      // near the end of the business-hours window could roll past midnight
      // onto the next calendar day.
      days: [startOfDay(candidate.start)],
      slotMinutes,
      snapMinutes,
      slotWidthPx,
      dayStartHour,
      dayEndHour,
    });
  }, [candidate.start, gridWrapperWidth, slotMinutes, snapMinutes, dayStartHour, dayEndHour]);

  // Every other real booking on the target day — read-only backdrop. Never
  // includes `event` itself: it isn't really on this day until Confirm, and
  // the synthetic pending block below (same id) stands in for it instead —
  // this filter is what keeps that substitution from double-rendering.
  const dayEvents = useMemo(
    () => events.filter((e) => e.id !== event.id && isSameDay(e.start, candidate.start)),
    [events, event.id, candidate.start],
  );

  const pendingEvent: SchedulerEvent = useMemo(
    () => ({ ...event, resourceId: candidate.resourceId, start: candidate.start, end: candidate.end }),
    [event, candidate],
  );

  const modalEvents = useMemo(() => [...dayEvents, pendingEvent], [dayEvents, pendingEvent]);

  // Re-checked on every reposition purely to drive the "still conflicts"
  // legend note — never gates Confirm, which stays enabled regardless.
  const { roomConflict, instructorConflict } = findConflicts(events, {
    resourceId: candidate.resourceId,
    instructorId: event.instructorId,
    start: candidate.start,
    end: candidate.end,
    excludeEventId: event.id,
  });
  const stillConflicts = Boolean(roomConflict || instructorConflict);
  // The instructor conflict is only worth calling out with its own color when
  // it's the reason the slot conflicts *and* it's in a different room than
  // the candidate — same-room instructor conflicts are already the room
  // conflict itself (same event, already shown in the uniform "Booked" red),
  // and highlighting it twice would be redundant.
  const instructorConflictElsewhere =
    instructorConflict && instructorConflict.resourceId !== candidate.resourceId ? instructorConflict : null;

  const eventColors = useMemo(() => {
    const map = new Map<string, string>();
    for (const e of dayEvents) {
      map.set(e.id, e.id === instructorConflictElsewhere?.id ? INSTRUCTOR_CONFLICT_COLOR : CONFLICT_COLOR);
    }
    map.set(pendingEvent.id, PENDING_COLOR);
    return map;
  }, [dayEvents, pendingEvent, instructorConflictElsewhere]);

  const nonInteractiveEventIds = useMemo(() => new Set(dayEvents.map((e) => e.id)), [dayEvents]);

  return (
    <>
      <div className={styles.header}>
        <div className={styles.headerText}>
          <h2 className={styles.title}>
            Moving to {weekdayLabel(newStart)}, {monthLabel(newStart)} {newStart.getDate()}
          </h2>
          <p className={styles.subtitle}>
            {event.title} · {formatTimeOfDay(candidate.start)}–{formatTimeOfDay(candidate.end)}
          </p>
        </div>
        <button type="button" className={styles.closeButton} onClick={onCancel} aria-label="Cancel move">
          <X size={20} />
        </button>
      </div>

      <p className={styles.instructions}>Hold and drag the event to a new slot, or confirm the default.</p>

      <div className={styles.legend}>
        <span className={styles.legendItem}>
          <span className={[styles.swatch, styles.swatchPending].join(' ')} /> Default placement
        </span>
        <span className={styles.legendItem}>
          <span className={[styles.swatch, styles.swatchConflict].join(' ')} /> Booked
        </span>
        {instructorConflictElsewhere && (
          <span className={styles.legendItem}>
            <span className={[styles.swatch, styles.swatchInstructorConflict].join(' ')} /> Instructor busy elsewhere
          </span>
        )}
        <span className={styles.legendItem}>
          <span className={[styles.swatch, styles.swatchOpen].join(' ')} /> Open
        </span>
        {stillConflicts && (
          <span className={styles.legendWarning}>
            {roomConflict
              ? `Room already booked for ${roomConflict.title}`
              : instructorConflictElsewhere
                ? `${event.instructorName} is also teaching ${instructorConflictElsewhere.title} in ${resources.find((r) => r.id === instructorConflictElsewhere.resourceId)?.title ?? 'another room'} at this time`
                : 'This slot still conflicts'}
          </span>
        )}
      </div>

      <div className={styles.gridWrapper} ref={gridWrapperRef}>
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
            highlightEvent={null}
            pendingSelection={null}
            geometry={geometry}
            editable
            eventColors={eventColors}
            // Same edge-detection auto-scroll as Day/Week (threaded through
            // from Scheduler's own configured values), so dragging near the
            // mini grid's edge scrolls it horizontally too.
            autoScrollThreshold={autoScrollThreshold}
            autoScrollSpeed={autoScrollSpeed}
            selectedEventId={null}
            hiddenClassTypes={EMPTY_CLASS_TYPES}
            hiddenInstructorIds={EMPTY_INSTRUCTOR_IDS}
            expandedResourceIds={expandedResourceIds}
            onToggleResourceExpanded={toggleExpanded}
            nonInteractiveEventIds={nonInteractiveEventIds}
            disableRowSelection
            onEventMove={(movedEvent, newResourceId, movedStart, movedEnd) => {
              // Defensive — nonInteractiveEventIds already prevents this firing
              // for any of the real (red) bookings.
              if (movedEvent.id !== pendingEvent.id) return;
              setCandidate({ resourceId: newResourceId, start: movedStart, end: movedEnd });
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
          onClick={() => onConfirm(candidate.resourceId, candidate.start, candidate.end)}
        >
          Confirm move
        </button>
      </div>
    </>
  );
}
