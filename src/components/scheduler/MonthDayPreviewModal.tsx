import { useEffect, useMemo, useRef } from 'react';
import { Redo2, Undo2, X } from 'lucide-react';
import { TimelineView, MIN_SLOT_WIDTH_PX, RESOURCE_COLUMN_WIDTH } from './TimelineView';
import { useElementWidth } from './hooks/useElementWidth';
import { createTimelineGeometry } from './utils/timeGeometry';
import { monthLabel, weekdayLabel } from './utils/dateMath';
import type { InstructorOption, Resource, SchedulerEvent, SchedulerProps } from './Scheduler.types';
import styles from './MonthDayPreviewModal.module.css';

export interface MonthDayPreviewModalProps {
  /** The day being previewed — null closes the modal. */
  day: Date | null;
  resources: Resource[];
  instructors: InstructorOption[];
  events: SchedulerEvent[];
  eventColors: Map<string, string>;
  dayStartHour: number;
  dayEndHour: number;
  slotMinutes: number;
  snapMinutes: number;
  editable: boolean;
  autoScrollThreshold: number;
  autoScrollSpeed: number;
  selectedEventId: string | null;
  highlightEvent: SchedulerEvent | null;
  hiddenClassTypes: Set<string>;
  hiddenInstructorIds: Set<number>;
  expandedResourceIds: Set<string>;
  onToggleResourceExpanded: (resourceId: string) => void;
  renderEvent?: SchedulerProps['renderEvent'];
  onEventClick?: SchedulerProps['onEventClick'];
  onEventDoubleClick?: SchedulerProps['onEventDoubleClick'];
  onEventInteractionStart?: (event: SchedulerEvent) => void;
  onEventMove?: SchedulerProps['onEventMove'];
  onEventResizeStart?: SchedulerProps['onEventResizeStart'];
  onEventResize?: SchedulerProps['onEventResize'];
  onEventResizeEnd?: SchedulerProps['onEventResizeEnd'];
  onSelection?: SchedulerProps['onSelection'];
  /** Mirrors the host app's own global undo/redo (see Scheduler.types.ts) — omit either pair to hide those buttons. */
  canUndo?: boolean;
  onUndo?: () => void;
  canRedo?: boolean;
  onRedo?: () => void;
  onClose: () => void;
}

/**
 * A full Day-view grid for a single date, opened from Month view's "View
 * day" hover button — same centered-modal chrome as MonthMoveConflictModal,
 * but otherwise just a real, fully-interactive Day view (reuses the same
 * TimelineView and the same handlers Scheduler.tsx already wires to its own
 * Day/Week TimelineView), not a read-only snapshot.
 */
export function MonthDayPreviewModal({
  day,
  resources,
  instructors,
  events,
  eventColors,
  dayStartHour,
  dayEndHour,
  slotMinutes,
  snapMinutes,
  editable,
  autoScrollThreshold,
  autoScrollSpeed,
  selectedEventId,
  highlightEvent,
  hiddenClassTypes,
  hiddenInstructorIds,
  expandedResourceIds,
  onToggleResourceExpanded,
  renderEvent,
  onEventClick,
  onEventDoubleClick,
  onEventInteractionStart,
  onEventMove,
  onEventResizeStart,
  onEventResize,
  onEventResizeEnd,
  onSelection,
  canUndo,
  onUndo,
  canRedo,
  onRedo,
  onClose,
}: MonthDayPreviewModalProps) {
  useEffect(() => {
    if (!day) return;
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [day, onClose]);

  if (!day) return null;

  return (
    // Unlike InstructorViewDialog/MonthMoveConflictModal, this modal is a
    // real, fully-interactive Day view grid — clicking empty space in it
    // should deselect the currently-open event, same as it does in the real
    // Day/Week view. So, deliberately, no data-*-dialog attribute here to
    // exempt it from EventDetailsDrawer/NewEventDrawer's click-outside close.
    <div className={styles.backdrop} onClick={onClose}>
      <div
        className={styles.card}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={`${weekdayLabel(day)}, ${monthLabel(day)} ${day.getDate()}`}
      >
        <MonthDayPreviewContent
          day={day}
          resources={resources}
          instructors={instructors}
          events={events}
          eventColors={eventColors}
          dayStartHour={dayStartHour}
          dayEndHour={dayEndHour}
          slotMinutes={slotMinutes}
          snapMinutes={snapMinutes}
          editable={editable}
          autoScrollThreshold={autoScrollThreshold}
          autoScrollSpeed={autoScrollSpeed}
          selectedEventId={selectedEventId}
          highlightEvent={highlightEvent}
          hiddenClassTypes={hiddenClassTypes}
          hiddenInstructorIds={hiddenInstructorIds}
          expandedResourceIds={expandedResourceIds}
          onToggleResourceExpanded={onToggleResourceExpanded}
          renderEvent={renderEvent}
          onEventClick={onEventClick}
          onEventDoubleClick={onEventDoubleClick}
          onEventInteractionStart={onEventInteractionStart}
          onEventMove={onEventMove}
          onEventResizeStart={onEventResizeStart}
          onEventResize={onEventResize}
          onEventResizeEnd={onEventResizeEnd}
          onSelection={onSelection}
          canUndo={canUndo}
          onUndo={onUndo}
          canRedo={canRedo}
          onRedo={onRedo}
          onClose={onClose}
        />
      </div>
    </div>
  );
}

function MonthDayPreviewContent({
  day,
  resources,
  instructors,
  events,
  eventColors,
  dayStartHour,
  dayEndHour,
  slotMinutes,
  snapMinutes,
  editable,
  autoScrollThreshold,
  autoScrollSpeed,
  selectedEventId,
  highlightEvent,
  hiddenClassTypes,
  hiddenInstructorIds,
  expandedResourceIds,
  onToggleResourceExpanded,
  renderEvent,
  onEventClick,
  onEventDoubleClick,
  onEventInteractionStart,
  onEventMove,
  onEventResizeStart,
  onEventResize,
  onEventResizeEnd,
  onSelection,
  canUndo,
  onUndo,
  canRedo,
  onRedo,
  onClose,
}: Omit<MonthDayPreviewModalProps, 'day'> & { day: Date }) {
  // Same measure-then-mount reasoning as MonthMoveConflictModal's gridWrapper:
  // TimelineView's geometry is a function of the measured width, so mounting
  // it before that settles risks a wrong-then-rescaled geometry.
  const gridWrapperRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const gridWrapperWidth = useElementWidth(gridWrapperRef);

  const geometry = useMemo(() => {
    const slotsPerDay = ((dayEndHour - dayStartHour) * 60) / slotMinutes;
    const availableWidth = Math.max(0, gridWrapperWidth - RESOURCE_COLUMN_WIDTH);
    const slotWidthPx = Math.max(MIN_SLOT_WIDTH_PX, Math.floor(availableWidth / slotsPerDay));
    return createTimelineGeometry({
      days: [day],
      slotMinutes,
      snapMinutes,
      slotWidthPx,
      dayStartHour,
      dayEndHour,
    });
  }, [day, gridWrapperWidth, slotMinutes, snapMinutes, dayStartHour, dayEndHour]);

  return (
    <>
      <div className={styles.header}>
        <h2 className={styles.title}>
          {weekdayLabel(day)}, {monthLabel(day)} {day.getDate()}
        </h2>
        <div className={styles.headerActions}>
          {onUndo && (
            <button
              type="button"
              className={styles.iconButton}
              onClick={onUndo}
              disabled={!canUndo}
              aria-label="Undo"
              title="Undo (Ctrl/Cmd+Z)"
            >
              <Undo2 size={18} />
            </button>
          )}
          {onRedo && (
            <button
              type="button"
              className={styles.iconButton}
              onClick={onRedo}
              disabled={!canRedo}
              aria-label="Redo"
              title="Redo (Ctrl/Cmd+Shift+Z)"
            >
              <Redo2 size={18} />
            </button>
          )}
          <button type="button" className={styles.iconButton} onClick={onClose} aria-label="Close day view">
            <X size={20} />
          </button>
        </div>
      </div>

      <div className={styles.gridWrapper} ref={gridWrapperRef}>
        {gridWrapperWidth > 0 && (
          <TimelineView
            resources={resources}
            events={events}
            instructors={instructors}
            highlightEvent={highlightEvent}
            pendingSelection={null}
            geometry={geometry}
            editable={editable}
            eventColors={eventColors}
            autoScrollThreshold={autoScrollThreshold}
            autoScrollSpeed={autoScrollSpeed}
            selectedEventId={selectedEventId}
            onEventInteractionStart={onEventInteractionStart}
            hiddenClassTypes={hiddenClassTypes}
            hiddenInstructorIds={hiddenInstructorIds}
            expandedResourceIds={expandedResourceIds}
            onToggleResourceExpanded={onToggleResourceExpanded}
            renderEvent={renderEvent}
            onEventClick={onEventClick}
            onEventDoubleClick={onEventDoubleClick}
            onEventMove={onEventMove}
            onEventResizeStart={onEventResizeStart}
            onEventResize={onEventResize}
            onEventResizeEnd={onEventResizeEnd}
            onSelection={onSelection}
            disableRowSelection
            scrollContainerRef={scrollContainerRef}
          />
        )}
      </div>
    </>
  );
}
