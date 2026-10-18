import { useCallback, useEffect, useRef, type RefObject } from 'react';
import { useAutoScroll } from './useAutoScroll';

export interface DragPoint {
  /** Position relative to the scroll container's content (i.e. includes scrollLeft/Top). */
  contentX: number;
  contentY: number;
  clientX: number;
  clientY: number;
}

export interface UsePointerDragOptions {
  containerRef: RefObject<HTMLElement | null>;
  autoScrollThreshold: number;
  autoScrollSpeed: number;
  /** Which axis (or axes) auto-scroll nudges while dragging near an edge — 'x' (default) for a horizontal timeline, 'y' for WeekViewVertical's vertical time axis, 'both' for a move-drag that can cross a room/day boundary and a time-of-day boundary in the same gesture (see EventBlock.tsx's moveDrag — unlike resize, which only ever moves along one axis). */
  autoScrollAxis?: 'x' | 'y' | 'both';
  /** Shifts the auto-scroll start-edge threshold inward — see useAutoScroll's own doc comment. Only meaningful for TimelineView's sticky resource column. */
  autoScrollStartInset?: number;
  onStart?: (point: DragPoint) => void;
  onMove: (point: DragPoint) => void;
  onEnd: (point: DragPoint) => void;
}

/**
 * Generic pointer-based "move" drag primitive. Deliberately uses window-level
 * listeners rather than `setPointerCapture` on the dragged element: auto-scroll
 * reflows content under the pointer mid-drag, and capture-on-element can miss
 * events if the element itself gets repositioned by the resulting re-render.
 */
export function usePointerDrag({
  containerRef,
  autoScrollThreshold,
  autoScrollSpeed,
  autoScrollAxis = 'x',
  autoScrollStartInset = 0,
  onStart,
  onMove,
  onEnd,
}: UsePointerDragOptions) {
  const autoScroll = useAutoScroll(containerRef, autoScrollThreshold, autoScrollSpeed, autoScrollAxis, autoScrollStartInset);
  const draggingRef = useRef(false);
  const lastClientRef = useRef({ x: 0, y: 0 });
  const previousUserSelectRef = useRef('');

  const computePoint = useCallback((clientX: number, clientY: number): DragPoint => {
    const container = containerRef.current;
    if (!container) return { contentX: 0, contentY: 0, clientX, clientY };
    const rect = container.getBoundingClientRect();
    return {
      contentX: clientX - rect.left + container.scrollLeft,
      contentY: clientY - rect.top + container.scrollTop,
      clientX,
      clientY,
    };
  }, [containerRef]);

  const handlePointerMove = useCallback((e: PointerEvent) => {
    if (!draggingRef.current) return;
    lastClientRef.current = { x: e.clientX, y: e.clientY };
    autoScroll.update(e.clientX, e.clientY);
    onMove(computePoint(e.clientX, e.clientY));
  }, [autoScroll, computePoint, onMove]);

  const handlePointerUpRef = useRef<(e: PointerEvent) => void>(() => {});

  const handlePointerUp = useCallback((e: PointerEvent) => {
    if (!draggingRef.current) return;
    draggingRef.current = false;
    autoScroll.stop();
    document.body.style.userSelect = previousUserSelectRef.current;
    window.removeEventListener('pointermove', handlePointerMove);
    window.removeEventListener('pointerup', handlePointerUpRef.current);
    onEnd(computePoint(e.clientX, e.clientY));
  }, [autoScroll, computePoint, onEnd, handlePointerMove]);

  useEffect(() => {
    handlePointerUpRef.current = handlePointerUp;
  });

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    e.stopPropagation();
    draggingRef.current = true;
    lastClientRef.current = { x: e.clientX, y: e.clientY };
    // Window-level listeners (not pointer capture — see above) mean the
    // browser still treats this as a text-selection drag, highlighting
    // header labels the pointer passes over. Suppressed for the drag only.
    previousUserSelectRef.current = document.body.style.userSelect;
    document.body.style.userSelect = 'none';
    onStart?.(computePoint(e.clientX, e.clientY));
    autoScroll.start(() => {
      onMove(computePoint(lastClientRef.current.x, lastClientRef.current.y));
    });
    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
  }, [onStart, autoScroll, computePoint, onMove, handlePointerMove, handlePointerUp]);

  return { onPointerDown };
}
