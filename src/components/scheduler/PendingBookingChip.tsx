import { useEffect, useRef } from 'react';
import { GripVertical, X } from 'lucide-react';
import { usePendingChipDrag } from './hooks/usePendingChipDrag';
import styles from './PendingBookingChip.module.css';

export interface PendingBookingChipProps {
  title: string;
  durationMinutes: number;
  /** Fired on release — Scheduler.tsx hit-tests (clientX, clientY) against whichever room/time cell (if any) is under the pointer (see its own handlePendingChipDrop) and only then decides whether this "sticks" (a real grid position) or the chip just snaps back for another attempt. */
  onDrop: (clientX: number, clientY: number) => void;
  onCancel: () => void;
  /** Pointer position on every move once a press has become a real drag (past the 6px click threshold) — drives Week view's DayJumpBar. */
  onDragMove?: (clientX: number, clientY: number) => void;
  /** Fired when a drag ends (dropped anywhere, or released in place). */
  onDragEnd?: () => void;
}

/**
 * The floating "not placed yet" stand-in for a pending Book/Assign
 * placement (see Scheduler.tsx's `pendingBooking`/`handlePendingChipDrop`) —
 * shown instead of a real grid-positioned EventBlock until the user actually
 * drags it onto a room/time cell, since a guessed default position (today's
 * wall-clock hour, the first room) can easily land outside whatever's
 * currently scrolled into view. Deliberately fixed to the viewport (not the
 * scrollable grid) so it stays visible and reachable regardless of scroll
 * position in either axis — the whole point of this component.
 *
 * Its own drag uses usePendingChipDrag — plain screen-space pointer
 * tracking, NOT the shared usePointerDrag hook every real EventBlock move
 * uses — that hook (and EventBlock's own handleMoveMove) computes the
 * dragged position from the EVENT'S OWN MODEL position (dateToX/rowLayout
 * offsets) plus a pointer delta, which only works when the thing being
 * dragged already occupies a real, meaningful grid position to begin with.
 * This chip doesn't (that's the point — it hasn't been placed anywhere real
 * yet), so it just follows the raw cursor and lets Scheduler.tsx hit-test
 * the drop point directly (via document.elementFromPoint against each
 * view's own data-pending-drop-resource-id cells) instead.
 */
export function PendingBookingChip({ title, durationMinutes, onDrop, onCancel, onDragMove, onDragEnd }: PendingBookingChipProps) {
  const pressRef = useRef({ x: 0, y: 0 });
  const { dragOffset, handlePointerDown, handlePointerMove, handlePointerUp } = usePendingChipDrag(onDrop, {
    onMove: (clientX, clientY) => {
      if (Math.hypot(clientX - pressRef.current.x, clientY - pressRef.current.y) >= 6) onDragMove?.(clientX, clientY);
    },
  });
  const dragging = dragOffset !== null;
  // Only on the drag's own start/stop transitions — see UnplacedClassesDrawer's
  // equivalent effect for the same pattern.
  useEffect(() => {
    if (!dragging) onDragEnd?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dragging]);
  // A successful drop unmounts this chip right away (the booking is now on
  // the grid — see Scheduler.tsx's `placed`), before the effect above ever
  // sees `dragging` go false — so report the end on unmount too, or the
  // DayJumpBar would stay up.
  const onDragEndRef = useRef(onDragEnd);
  useEffect(() => {
    onDragEndRef.current = onDragEnd;
  });
  useEffect(() => () => onDragEndRef.current?.(), []);

  return (
    <div
      className={styles.chip}
      // The chip's own at-rest centering (.chip's own `left: 50%; transform:
      // translateX(-50%)`) has to stay part of this transform, not be
      // replaced by it — an inline `transform` here fully overrides the
      // stylesheet's own, so dragOffset alone would snap the chip sideways
      // by half its own width the instant a drag starts (translateX(-50%)
      // suddenly gone), then have it visibly trail the cursor by that same
      // fixed offset for the rest of the gesture — exactly the "floats to
      // the side of my cursor" bug this fixes.
      style={
        dragOffset
          ? {
              transform: `translate(calc(-50% + ${dragOffset.x}px), ${dragOffset.y}px)`,
              transition: 'none',
              // The whole point of fixing the "floats to the side" bug was
              // making this track the cursor EXACTLY — but that means the
              // cursor now sits INSIDE this chip's own rendered body for the
              // entire drag (you grabbed it from somewhere in its middle,
              // not its corner), so Scheduler.tsx's own
              // document.elementFromPoint(clientX, clientY) hit-test (see
              // onDrop's own doc comment) would always find THIS element
              // instead of whatever room/time cell is underneath it —
              // silently failing every drop. pointer-events: none makes the
              // chip transparent to that hit-test while dragging; the drag
              // itself keeps working regardless, since setPointerCapture
              // (below) routes pointermove/pointerup straight to the
              // capturing element by id, bypassing normal hit-testing (and
              // therefore this CSS) entirely.
              pointerEvents: 'none',
            }
          : undefined
      }
      role="button"
      aria-label={`Drag ${title} into a room and time slot`}
    >
      <div
        className={styles.grabHandle}
        onPointerDown={(e) => {
          pressRef.current = { x: e.clientX, y: e.clientY };
          handlePointerDown(e);
        }}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
      >
        <GripVertical size={14} strokeWidth={2.25} />
        <div className={styles.text}>
          <span className={styles.title}>{title}</span>
          <span className={styles.hint}>
            {durationMinutes} min — drag into a room &amp; time
          </span>
        </div>
      </div>
      <button type="button" className={styles.cancelButton} onClick={onCancel} aria-label="Cancel booking">
        <X size={14} strokeWidth={2.25} />
      </button>
    </div>
  );
}
