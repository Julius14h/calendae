import { useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react';
import { X } from 'lucide-react';
import { usePendingChipDrag } from './hooks/usePendingChipDrag';
import { initialsFor } from './utils/initials';
import { colorForInstructor } from './utils/instructorColor';
import type { ClassTypeOption, UnplacedClass } from './Scheduler.types';
import styles from './UnplacedClassesDrawer.module.css';

export interface UnplacedClassesDrawerProps {
  open: boolean;
  onClose: () => void;
  unplacedClasses: UnplacedClass[];
  classTypes: ClassTypeOption[];
  /** Fired on release — Scheduler.tsx hit-tests (clientX, clientY) against whichever room/time cell (if any) is under the pointer (see its own handleUnplacedChipDrop) and only then decides whether this "sticks" (a real event) or the chip just snaps back into the list. */
  onDrop: (id: string, clientX: number, clientY: number) => void;
  onDismiss: (id: string) => void;
  /** Fired on a genuine click (near-zero pointer movement — see usePendingChipDrag's own click/drag distinction) — opens UnplacedClassPopover anchored to the chip's own rect. */
  onOpenDetails: (item: UnplacedClass, anchorRect: DOMRect) => void;
  /** Fired whenever any row starts or stops dragging (item, or null once it stops) — lets Scheduler.tsx show the same instructor-availability overlay while dragging an unplaced class as it already does while dragging the review-modal's own pending chip. */
  onDragStateChange: (item: UnplacedClass | null) => void;
  /** Pointer position on every move once a press has become a real drag (past the click threshold) — drives Week view's DayJumpBar. */
  onDragMove?: (clientX: number, clientY: number) => void;
}

/**
 * Persistent side panel (pushes the calendar over, no backdrop, no
 * outside-click-close — see SchedulerDrawer.tsx's own shell, which this
 * mirrors) listing classes with no room/time yet: newly-imported ones from
 * a roster merge (see SchedulerPage.tsx's mergeRosterIntoSchedule) and any
 * sent back via an event popover's "Unschedule" button. A backdrop modal
 * (like ClassesToReviewModal.tsx) would fight with actively dragging a chip
 * out of it onto the calendar behind it, so this is a push-layout panel
 * instead — always interactive alongside the grid, not floating over it.
 * Toggled from CreateFab's own menu item, but also closable from its own
 * header (unlike SchedulerDrawer, which only has the one toggle).
 */
export function UnplacedClassesDrawer({
  open,
  onClose,
  unplacedClasses,
  classTypes,
  onDrop,
  onDismiss,
  onOpenDetails,
  onDragStateChange,
  onDragMove,
}: UnplacedClassesDrawerProps) {
  return (
    <div className={[styles.drawer, open ? styles.drawerOpen : ''].join(' ').trim()} aria-hidden={!open}>
      <div className={styles.content}>
        <div className={styles.header}>
          <h3 className={styles.title}>Classes Bin</h3>
          <button type="button" className={styles.closeButton} onClick={onClose} aria-label="Close classes bin">
            <X size={18} />
          </button>
        </div>
        {unplacedClasses.length === 0 ? (
          <p className={styles.emptyState}>Nothing waiting to be placed.</p>
        ) : (
          <div className={styles.list}>
            {unplacedClasses.map((item) => (
              <UnplacedClassRow
                key={item.id}
                item={item}
                color={classTypes.find((ct) => ct.name === item.type)?.color ?? 'var(--sched-accent)'}
                onDrop={onDrop}
                onDismiss={onDismiss}
                onOpenDetails={onOpenDetails}
                onDragStateChange={onDragStateChange}
                onDragMove={onDragMove}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * The chip's inner content — laid out just like EventBlock's own default
 * content (avatar leading column, title + duration stacked beside it) so an
 * unplaced class reads as "the same class, just not on the grid yet" rather
 * than a differently-designed object. `color` is the domain's own event
 * color (--event-color, tonal-filled background + left accent bar exactly
 * like EventBlock.module.css's own .event); the avatar is colored per
 * INSTRUCTOR instead (colorForInstructor), same split EventBlock itself
 * uses, so the same instructor still reads as the same color everywhere.
 */
function ChipContent({ item }: { item: UnplacedClass }) {
  return (
    <>
      <span
        className={styles.avatar}
        style={{ '--avatar-color': colorForInstructor(item.instructorId) } as CSSProperties}
        title={item.instructorName}
      >
        {initialsFor(item.instructorName)}
      </span>
      <div className={styles.textStack}>
        <div className={styles.rowTitle}>{item.title}</div>
        <div className={styles.rowMeta}>{item.durationMinutes} min</div>
      </div>
    </>
  );
}

function UnplacedClassRow({
  item,
  color,
  onDrop,
  onDismiss,
  onOpenDetails,
  onDragStateChange,
  onDragMove,
}: {
  item: UnplacedClass;
  color: string;
  onDrop: (id: string, clientX: number, clientY: number) => void;
  onDismiss: (id: string) => void;
  onOpenDetails: (item: UnplacedClass, anchorRect: DOMRect) => void;
  onDragStateChange: (item: UnplacedClass | null) => void;
  onDragMove?: (clientX: number, clientY: number) => void;
}) {
  const rowRef = useRef<HTMLDivElement>(null);
  // Captured at grab time — the floating clone below renders at this fixed
  // screen position (offset by dragOffset), rather than PendingBookingChip's
  // own centered-at-a-fixed-viewport-spot rest position, since this chip's
  // "rest" position is wherever it happens to sit in the list. State (not a
  // ref) since it drives what gets rendered.
  const [originRect, setOriginRect] = useState<{ top: number; left: number; width: number } | null>(null);
  const pressRef = useRef({ x: 0, y: 0 });
  const { dragOffset, handlePointerDown, handlePointerMove, handlePointerUp } = usePendingChipDrag(
    (clientX, clientY) => onDrop(item.id, clientX, clientY),
    {
      onClick: (e) => onOpenDetails(item, e.currentTarget.getBoundingClientRect()),
      // Same 6px as usePendingChipDrag's own click threshold, so a plain
      // click never flashes the DayJumpBar.
      onMove: (clientX, clientY) => {
        if (Math.hypot(clientX - pressRef.current.x, clientY - pressRef.current.y) >= 6) onDragMove?.(clientX, clientY);
      },
    },
  );

  // The WHOLE chip is the grab surface (not a separate small handle) —
  // matches EventBlock's own .event, which puts onPointerDown on the
  // entire block. The dismiss button below stops this same event from
  // bubbling up to here, so clicking it doesn't also start a (zero-
  // distance) drag.
  function handleRowPointerDown(e: ReactPointerEvent<HTMLDivElement>) {
    const rect = rowRef.current?.getBoundingClientRect();
    if (rect) setOriginRect({ top: rect.top, left: rect.left, width: rect.width });
    pressRef.current = { x: e.clientX, y: e.clientY };
    handlePointerDown(e);
  }

  const dragging = dragOffset !== null && originRect !== null;

  // Reports to Scheduler.tsx only on the true start/stop transitions (not
  // every intermediate move) so it can drive the same instructor-
  // availability overlay the review-modal's own pending chip already gets
  // while dragging — see Scheduler.tsx's own handleUnplacedDragStateChange,
  // which is itself stable (useCallback), so this effect only re-fires on
  // an actual start/stop, not on unrelated parent re-renders.
  useEffect(() => {
    onDragStateChange(dragging ? item : null);
    return () => {
      if (dragging) onDragStateChange(null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dragging]);

  return (
    <>
      <div
        ref={rowRef}
        className={[styles.row, dragging ? styles.rowDragging : ''].join(' ').trim()}
        style={{ '--event-color': color } as CSSProperties}
        onPointerDown={handleRowPointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        role="button"
        aria-label={`Drag ${item.title} into a room and time slot`}
      >
        <ChipContent item={item} />
        <button
          type="button"
          className={styles.dismissButton}
          onClick={() => onDismiss(item.id)}
          onPointerDown={(e) => e.stopPropagation()}
          aria-label={`Dismiss ${item.title}`}
        >
          <X size={14} strokeWidth={2.25} />
        </button>
      </div>
      {dragging && dragOffset && originRect && (
        <div
          className={styles.floatingChip}
          style={
            {
              top: originRect.top,
              left: originRect.left,
              width: originRect.width,
              '--event-color': color,
              // pointerEvents: 'none' lets document.elementFromPoint (used by
              // Scheduler.tsx's handleUnplacedChipDrop) see through this to
              // the real grid cell underneath — same reasoning as
              // PendingBookingChip's own identical composition.
              transform: `translate(${dragOffset.x}px, ${dragOffset.y}px)`,
              pointerEvents: 'none',
            } as CSSProperties
          }
        >
          <ChipContent item={item} />
        </div>
      )}
    </>
  );
}
