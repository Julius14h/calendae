import { useCallback, useEffect, useMemo, useRef, type RefObject } from 'react';

/**
 * Edge-detection auto-scroll for drag interactions. While a drag is active,
 * feed pointer positions in via `update`; if the pointer is within `threshold`
 * px of the scroll container's visible edge along `axis` (left/right for 'x',
 * top/bottom for 'y'), the container's scroll position is nudged every
 * animation frame (proportionally to how close the pointer is to the edge,
 * capped at `speed` px/frame). `onTick` is invoked whenever the scroll
 * position actually changes so the caller can recompute a drag preview even
 * while the pointer itself stays still.
 */
export function useAutoScroll(
  containerRef: RefObject<HTMLElement | null>,
  threshold: number,
  speed: number,
  // 'x' (default) nudges scrollLeft for a horizontal timeline; 'y' nudges
  // scrollTop instead, for WeekViewVertical's vertical time axis.
  axis: 'x' | 'y' = 'x',
  // Shifts the *start* edge (left for 'x', top for 'y') inward by this many
  // px before measuring the threshold zone — for TimelineView's own sticky
  // resource column, which overlays the first RESOURCE_COLUMN_WIDTH px of
  // this same scrollable container rather than living in separate layout
  // space (unlike the details drawer, a true sibling panel that already
  // shrinks the container's own rect for free). Without this, the container's
  // raw rect.left sits *behind* that sticky column, so the threshold zone
  // was only reachable by dragging the pointer underneath it — visually
  // indistinguishable from "drag all the way to the far edge". The end
  // edge (right/bottom) has no equivalent occluding overlay, so it's never
  // adjusted.
  startInset = 0,
) {
  const rafRef = useRef<number | null>(null);
  const clientPosRef = useRef(0);
  const activeRef = useRef(false);
  const onTickRef = useRef<(() => void) | null>(null);
  const tickRef = useRef<() => void>(() => {});

  const tick = useCallback(() => {
    if (!activeRef.current) {
      rafRef.current = null;
      return;
    }
    const container = containerRef.current;
    if (container) {
      const rect = container.getBoundingClientRect();
      const pos = clientPosRef.current;
      const edgeStart = (axis === 'y' ? rect.top : rect.left) + startInset;
      const edgeEnd = axis === 'y' ? rect.bottom : rect.right;
      const distFromStart = pos - edgeStart;
      const distFromEnd = edgeEnd - pos;
      let delta = 0;
      if (distFromStart >= 0 && distFromStart < threshold) {
        delta = -speed * (1 - distFromStart / threshold);
      } else if (distFromEnd >= 0 && distFromEnd < threshold) {
        delta = speed * (1 - distFromEnd / threshold);
      }
      if (delta !== 0) {
        if (axis === 'y') {
          const maxScrollTop = container.scrollHeight - container.clientHeight;
          const prev = container.scrollTop;
          container.scrollTop = Math.min(maxScrollTop, Math.max(0, prev + delta));
          if (container.scrollTop !== prev) onTickRef.current?.();
        } else {
          const maxScrollLeft = container.scrollWidth - container.clientWidth;
          const prev = container.scrollLeft;
          container.scrollLeft = Math.min(maxScrollLeft, Math.max(0, prev + delta));
          if (container.scrollLeft !== prev) onTickRef.current?.();
        }
      }
    }
    // Indirected through a ref (rather than calling `tick` itself) so the
    // recursive rAF chain always calls the latest closure, not a stale one.
    rafRef.current = requestAnimationFrame(() => tickRef.current());
  }, [containerRef, threshold, speed, axis, startInset]);

  useEffect(() => {
    tickRef.current = tick;
  });

  const start = useCallback((onTick?: () => void) => {
    activeRef.current = true;
    onTickRef.current = onTick ?? null;
    if (rafRef.current == null) {
      rafRef.current = requestAnimationFrame(() => tickRef.current());
    }
  }, []);

  const update = useCallback((clientPos: number) => {
    clientPosRef.current = clientPos;
  }, []);

  const stop = useCallback(() => {
    activeRef.current = false;
    if (rafRef.current != null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
  }, []);

  useEffect(() => stop, [stop]);

  // Memoized: start/update/stop are each already stable (empty-dep
  // useCallback), but returning a fresh `{ start, update, stop }` object
  // literal every render still gave usePointerDrag/usePointerResize's own
  // internal callbacks (which depend on this whole object) a new identity
  // on every render — which meant *their* window-level pointermove/pointerup
  // listeners (attached exactly once, at the pointerdown that starts a
  // drag) could never be reliably removed again, since the cleanup call
  // looks up "the latest version" via a ref that no longer matched what was
  // actually attached. Memoizing this return value is what makes the whole
  // chain — down to onPointerDown itself — genuinely stable across a
  // caller's re-renders, not just superficially so.
  return useMemo(() => ({ start, update, stop }), [start, update, stop]);
}
