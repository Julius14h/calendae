import { useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';

export interface PendingChipDragHandlers {
  /** Non-null exactly while a drag is in progress — the accumulated cursor delta since pointer-down, in screen px. */
  dragOffset: { x: number; y: number } | null;
  handlePointerDown: (e: ReactPointerEvent<HTMLElement>) => void;
  handlePointerMove: (e: ReactPointerEvent<HTMLElement>) => void;
  handlePointerUp: (e: ReactPointerEvent<HTMLElement>) => void;
}

export interface UsePendingChipDragOptions {
  /** Fired instead of `onDrop` when release happens within `clickThresholdPx` of the pointer-down origin — lets a chip that also supports click-to-view-details (see UnplacedClassesDrawer.tsx) distinguish "picked it up and put it right back down" from an intentional drag, same reasoning as EventBlock.tsx's own CLICK_MOVE_THRESHOLD_PX. Omit to treat every release as a drop, matching this hook's original behavior (see PendingBookingChip.tsx, which has no click affordance of its own). */
  onClick?: (e: ReactPointerEvent<HTMLElement>) => void;
  /** Fired on every pointer move while dragging, with the raw screen position — lets Scheduler.tsx drive Week view's DayJumpBar hover (pointer capture keeps the bar's own hover events from firing). */
  onMove?: (clientX: number, clientY: number) => void;
  /** Default 6px — deliberately smaller than EventBlock's own 8px: these rows are much smaller click targets, so a slightly tighter tolerance still comfortably absorbs ordinary click jitter without eating into genuine short drags. */
  clickThresholdPx?: number;
}

/**
 * Shared pointer-capture drag tracking for a floating "not yet placed" chip
 * — raw screen-space cursor following, not the shared usePointerDrag hook
 * (that one computes position from the dragged item's EXISTING grid
 * position plus a delta, which a not-yet-placed chip doesn't have to begin
 * with). Extracted from PendingBookingChip.tsx's own original inline
 * implementation so UnplacedClassesDrawer's per-row chips can reuse the
 * identical mechanics (including the setPointerCapture behavior that keeps
 * move/up routed to the grab handle regardless of what's rendered on top of
 * it) without duplicating them.
 *
 * `onDrop` fires on release with the raw (clientX, clientY) — the caller
 * hit-tests that point against whatever grid cell (if any) is under it (see
 * Scheduler.tsx's handlePendingChipDrop/handleUnplacedChipDrop) and decides
 * whether this "sticks" or the chip just snaps back for another attempt.
 */
export function usePendingChipDrag(
  onDrop: (clientX: number, clientY: number) => void,
  options?: UsePendingChipDragOptions,
): PendingChipDragHandlers {
  const [dragOffset, setDragOffset] = useState<{ x: number; y: number } | null>(null);
  const originRef = useRef({ x: 0, y: 0 });

  function handlePointerDown(e: ReactPointerEvent<HTMLElement>) {
    if (e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    originRef.current = { x: e.clientX, y: e.clientY };
    setDragOffset({ x: 0, y: 0 });
  }

  function handlePointerMove(e: ReactPointerEvent<HTMLElement>) {
    if (!dragOffset) return;
    setDragOffset({ x: e.clientX - originRef.current.x, y: e.clientY - originRef.current.y });
    options?.onMove?.(e.clientX, e.clientY);
  }

  function handlePointerUp(e: ReactPointerEvent<HTMLElement>) {
    if (!dragOffset) return;
    const distance = Math.hypot(dragOffset.x, dragOffset.y);
    setDragOffset(null);
    if (options?.onClick && distance < (options.clickThresholdPx ?? 6)) {
      options.onClick(e);
      return;
    }
    onDrop(e.clientX, e.clientY);
  }

  return { dragOffset, handlePointerDown, handlePointerMove, handlePointerUp };
}
