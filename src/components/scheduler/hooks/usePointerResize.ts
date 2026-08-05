import { useCallback, useEffect, useRef, type RefObject } from 'react';
import { useAutoScroll } from './useAutoScroll';
import type { ResizeEdge } from '../Scheduler.types';

export interface UsePointerResizeOptions {
  containerRef: RefObject<HTMLElement | null>;
  autoScrollThreshold: number;
  autoScrollSpeed: number;
  /** Which axis the resize handle (and its auto-scroll) operates along — 'x' (default) for horizontal Day/Week's left/right edges, 'y' for WeekViewVertical's top/bottom edges. */
  axis?: 'x' | 'y';
  /** Shifts the auto-scroll start-edge threshold inward — see useAutoScroll's own doc comment. Only meaningful for TimelineView's sticky resource column. */
  autoScrollStartInset?: number;
  onStart?: (contentPos: number, edge: ResizeEdge) => void;
  onMove: (contentPos: number, edge: ResizeEdge) => void;
  onEnd: (contentPos: number, edge: ResizeEdge) => void;
}

/** Generic pointer-based resize primitive for dragging an event's start/end edge. */
export function usePointerResize({
  containerRef,
  autoScrollThreshold,
  autoScrollSpeed,
  axis = 'x',
  autoScrollStartInset = 0,
  onStart,
  onMove,
  onEnd,
}: UsePointerResizeOptions) {
  const autoScroll = useAutoScroll(containerRef, autoScrollThreshold, autoScrollSpeed, axis, autoScrollStartInset);
  const activeEdgeRef = useRef<ResizeEdge | null>(null);
  const lastClientPosRef = useRef(0);

  // Single positional value along whichever axis is active — mirrors the
  // original (pre-orientation) computeContentX's shape, so callers don't
  // need to juggle a clientX/clientY pair when only one axis ever matters.
  const computeContentPos = useCallback((pos: number) => {
    const container = containerRef.current;
    if (!container) return 0;
    const rect = container.getBoundingClientRect();
    return axis === 'y' ? pos - rect.top + container.scrollTop : pos - rect.left + container.scrollLeft;
  }, [containerRef, axis]);

  const clientPos = useCallback((e: { clientX: number; clientY: number }) => (axis === 'y' ? e.clientY : e.clientX), [axis]);

  const handlePointerMove = useCallback((e: PointerEvent) => {
    const edge = activeEdgeRef.current;
    if (!edge) return;
    const pos = clientPos(e);
    lastClientPosRef.current = pos;
    autoScroll.update(pos);
    onMove(computeContentPos(pos), edge);
  }, [autoScroll, computeContentPos, onMove, clientPos]);

  const handlePointerUpRef = useRef<(e: PointerEvent) => void>(() => {});

  const handlePointerUp = useCallback((e: PointerEvent) => {
    const edge = activeEdgeRef.current;
    if (!edge) return;
    activeEdgeRef.current = null;
    autoScroll.stop();
    window.removeEventListener('pointermove', handlePointerMove);
    window.removeEventListener('pointerup', handlePointerUpRef.current);
    onEnd(computeContentPos(clientPos(e)), edge);
  }, [autoScroll, computeContentPos, onEnd, handlePointerMove, clientPos]);

  useEffect(() => {
    handlePointerUpRef.current = handlePointerUp;
  });

  const onPointerDown = useCallback((e: React.PointerEvent, edge: ResizeEdge) => {
    e.stopPropagation();
    activeEdgeRef.current = edge;
    const pos = clientPos(e);
    lastClientPosRef.current = pos;
    onStart?.(computeContentPos(pos), edge);
    autoScroll.start(() => onMove(computeContentPos(lastClientPosRef.current), edge));
    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
  }, [onStart, autoScroll, computeContentPos, onMove, handlePointerMove, handlePointerUp, clientPos]);

  return { onPointerDown };
}
