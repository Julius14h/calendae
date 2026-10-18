import { useRef, useState, type RefObject } from 'react';
import { usePointerDrag } from './hooks/usePointerDrag';
import { usePanScroll } from './hooks/usePanScroll';
import { dateToX, hourWidthPx, hoursOfDay, xToDate, type TimelineGeometry } from './utils/timeGeometry';
import type { PendingSelection, SchedulerProps } from './Scheduler.types';
import styles from './TimelineView.module.css';

const CLICK_MOVE_THRESHOLD_PX = 3;

export interface ResourceRowProps {
  resourceId: string;
  top: number;
  height: number;
  geometry: TimelineGeometry;
  resourceColumnWidth: number;
  containerRef: RefObject<HTMLElement | null>;
  autoScrollThreshold: number;
  autoScrollSpeed: number;
  /** Drag-to-select (create event) only fires while true; while false, the same drag pans the timeline instead — either way a plain click still reports onDateClick. */
  editable: boolean;
  onSelection?: SchedulerProps['onSelection'];
  onDateClick?: SchedulerProps['onDateClick'];
  /** Non-null only for the row matching a pending "new event" selection — kept highlighted after the drag ends, until that drawer closes. */
  persistentSelection?: PendingSelection | null;
  /** Reports hover enter/leave over this row's canvas band, so the parent can reveal the room's expand/collapse toggle (which lives in the separate sticky name column) while either half of the row is hovered. */
  onHoverChange?: (hovering: boolean) => void;
}

/**
 * The scrollable "canvas" half of a resource row: hour gridlines are real
 * bordered cells with the exact same box model as `TimeHeader`'s hour cells
 * (rather than a CSS background pattern), so the two can never round
 * differently and drift apart. Also handles pointer interaction: while
 * `editable`, dragging across empty space selects a time range; otherwise
 * (every real view today — see TimelineView's own `disableRowSelection`) the
 * same drag pans the timeline instead. Either way a plain click (no drag)
 * reports a single date/time via onDateClick.
 */
export function ResourceRow({
  resourceId,
  top,
  height,
  geometry,
  resourceColumnWidth,
  containerRef,
  autoScrollThreshold,
  autoScrollSpeed,
  editable,
  onSelection,
  onDateClick,
  persistentSelection,
  onHoverChange,
}: ResourceRowProps) {
  const [selection, setSelection] = useState<{ x1: number; x2: number } | null>(null);
  // Mirrors `selection` outside React state so onEnd can read its latest
  // value synchronously instead of reaching for it from inside a setState
  // updater function — calling onSelection/onDateClick (which themselves
  // call setState further up the tree, in Scheduler.tsx) from inside an
  // updater is exactly the "Cannot update a component while rendering a
  // different component" hazard, since updaters can run during render, not
  // just at commit time (same reasoning as EventBlock.tsx's own previewRef).
  // This went unnoticed for a long time because `editable` was always false
  // here in practice (TimelineView's own `disableRowSelection` used to be
  // permanently on) — selection was dead code until that changed.
  const selectionRef = useRef<{ x1: number; x2: number } | null>(null);
  const setSelectionAndRef = (next: { x1: number; x2: number } | null) => {
    selectionRef.current = next;
    setSelection(next);
  };

  const drag = usePointerDrag({
    containerRef,
    autoScrollThreshold,
    autoScrollSpeed,
    autoScrollStartInset: resourceColumnWidth,
    onStart: (point) => {
      const x = point.contentX - resourceColumnWidth;
      setSelectionAndRef({ x1: x, x2: x });
    },
    onMove: (point) => {
      const x = point.contentX - resourceColumnWidth;
      const current = selectionRef.current;
      setSelectionAndRef(current ? { x1: current.x1, x2: x } : { x1: x, x2: x });
    },
    onEnd: (point) => {
      const x = point.contentX - resourceColumnWidth;
      const current = selectionRef.current;
      setSelectionAndRef(null);
      if (!current) return;
      const moved = Math.abs(x - current.x1) > CLICK_MOVE_THRESHOLD_PX;
      if (moved && editable) {
        const start = xToDate(Math.min(current.x1, x), geometry);
        const end = xToDate(Math.max(current.x1, x), geometry);
        onSelection?.(resourceId, start, end);
      } else if (!moved) {
        onDateClick?.(xToDate(current.x1, geometry), resourceId);
      }
      // moved && !editable: handled by `pan` below instead — see its own
      // onPointerDown, which is what actually gets attached in that case.
    },
  });

  // When drag-to-select-a-new-event is off (TimelineView's own
  // `disableRowSelection`, on except while the "Add class" drawer is open —
  // see Scheduler.tsx's own pendingSelection), the same gesture instead pans
  // the shared scroll container: a plain click still reports onDateClick,
  // but a drag scrolls rather than being a dead no-op.
  const pan = usePanScroll({
    containerRef,
    onClick: (point) => onDateClick?.(xToDate(point.contentX - resourceColumnWidth, geometry), resourceId),
  });

  const hourWidth = hourWidthPx(geometry);
  const hours = hoursOfDay(geometry);

  return (
    <div
      className={[styles.rowBackground, !editable ? styles.rowBackgroundPannable : ''].join(' ').trim()}
      style={{
        top,
        height,
        width: geometry.totalWidthPx,
      }}
      onPointerDown={editable ? drag.onPointerDown : pan.onPointerDown}
      onMouseEnter={() => onHoverChange?.(true)}
      onMouseLeave={() => onHoverChange?.(false)}
      // Hit-test target for Scheduler.tsx's pending-booking "staging chip"
      // — see its own handlePendingChipDrop. No day-index attribute (unlike
      // WeekViewVertical's own equivalent): this row already spans every
      // visible day, and Scheduler.tsx's own multi-day `geometry`/`xToDate`
      // resolves the right one directly from the raw X position.
      data-pending-drop-resource-id={resourceId}
      // Exempts a mousedown here from NewEventDrawer.tsx's own "click
      // outside closes it" guard — see its own comment on this same
      // attribute (WeekViewVertical.tsx's equivalent cell carries it too).
      data-scheduler-selectable-bg
    >
      {geometry.days.map((day, dayIndex) => (
        <div key={day.getTime()} className={styles.rowDayGroup} style={{ width: geometry.dayWidthPx }}>
          {hours.map((hour, i) => (
            <div
              key={hour}
              className={[
                styles.rowHourCell,
                i === hours.length - 1 && dayIndex !== geometry.days.length - 1 ? styles.dayBoundary : '',
              ].join(' ').trim()}
              style={{ width: hourWidth }}
            />
          ))}
        </div>
      ))}
      {selection && editable ? (
        <div
          className={styles.selectionOverlay}
          style={{
            left: Math.min(selection.x1, selection.x2),
            width: Math.abs(selection.x2 - selection.x1),
          }}
        />
      ) : (
        persistentSelection && (
          <div
            className={styles.selectionOverlay}
            style={{
              left: dateToX(persistentSelection.start, geometry),
              width: dateToX(persistentSelection.end, geometry) - dateToX(persistentSelection.start, geometry),
            }}
          />
        )
      )}
    </div>
  );
}
