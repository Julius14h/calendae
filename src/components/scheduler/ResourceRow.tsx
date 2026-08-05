import { useState, type RefObject } from 'react';
import { usePointerDrag } from './hooks/usePointerDrag';
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
  /** Drag-to-select (create event) only fires while true — locked mode still allows a plain click through to onDateClick. */
  editable: boolean;
  onSelection?: SchedulerProps['onSelection'];
  onDateClick?: SchedulerProps['onDateClick'];
  /** Non-null only for the row matching a pending "new event" selection — kept highlighted after the drag ends, until that drawer closes. */
  persistentSelection?: PendingSelection | null;
}

/**
 * The scrollable "canvas" half of a resource row: hour gridlines are real
 * bordered cells with the exact same box model as `TimeHeader`'s hour cells
 * (rather than a CSS background pattern), so the two can never round
 * differently and drift apart. Also handles pointer interaction: dragging
 * across empty space selects a time range, a plain click reports a single
 * date/time.
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
}: ResourceRowProps) {
  const [selection, setSelection] = useState<{ x1: number; x2: number } | null>(null);

  const drag = usePointerDrag({
    containerRef,
    autoScrollThreshold,
    autoScrollSpeed,
    autoScrollStartInset: resourceColumnWidth,
    onStart: (point) => {
      const x = point.contentX - resourceColumnWidth;
      setSelection({ x1: x, x2: x });
    },
    onMove: (point) => {
      const x = point.contentX - resourceColumnWidth;
      setSelection((current) => (current ? { x1: current.x1, x2: x } : { x1: x, x2: x }));
    },
    onEnd: (point) => {
      const x = point.contentX - resourceColumnWidth;
      setSelection((current) => {
        if (!current) return null;
        const moved = Math.abs(x - current.x1) > CLICK_MOVE_THRESHOLD_PX;
        if (moved && editable) {
          const start = xToDate(Math.min(current.x1, x), geometry);
          const end = xToDate(Math.max(current.x1, x), geometry);
          onSelection?.(resourceId, start, end);
        } else if (!moved) {
          onDateClick?.(xToDate(current.x1, geometry), resourceId);
        }
        // moved && !editable: locked — a drag that goes nowhere, no-op.
        return null;
      });
    },
  });

  const hourWidth = hourWidthPx(geometry);
  const hours = hoursOfDay(geometry);

  return (
    <div
      className={styles.rowBackground}
      style={{
        top,
        height,
        width: geometry.totalWidthPx,
      }}
      onPointerDown={drag.onPointerDown}
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
