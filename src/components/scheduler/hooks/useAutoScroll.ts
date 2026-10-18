import { useCallback, useEffect, useMemo, useRef, type RefObject } from 'react';

/**
 * Edge-detection auto-scroll for drag interactions. While a drag is active,
 * feed pointer positions in via `update(clientX, clientY)`; if the pointer is
 * within `threshold` px of the scroll container's visible edge along `axis`
 * (left/right for 'x', top/bottom for 'y', or both independently for
 * 'both' — a move-drag can need to cross both a room boundary and a
 * time-of-day boundary at once, since the same scroll container often
 * scrolls in both directions), the container's scroll position is nudged
 * every animation frame (proportionally to how close the pointer is to the
 * edge, capped at `speed` px/frame). `onTick` is invoked whenever the scroll
 * position actually changes (on either axis) so the caller can recompute a
 * drag preview even while the pointer itself stays still.
 */
export function useAutoScroll(
  containerRef: RefObject<HTMLElement | null>,
  threshold: number,
  speed: number,
  // 'x' nudges scrollLeft only (a horizontal timeline's own resize handles,
  // which only ever move along one axis); 'y' nudges scrollTop only
  // (WeekViewVertical's resize handles, same reasoning); 'both' checks and
  // nudges each axis independently in the same tick — see EventBlock.tsx's
  // move-drag, which (unlike resize) can need to scroll toward a different
  // room/day AND a different time-of-day in the same drag, regardless of
  // which axis happens to be the view's own "primary" one.
  axis: 'x' | 'y' | 'both' = 'x',
  // Shifts the horizontal start edge (left) inward by this many px before
  // measuring the x threshold zone — for TimelineView's own sticky resource
  // column, which overlays the first RESOURCE_COLUMN_WIDTH px of this same
  // scrollable container rather than living in separate layout space (unlike
  // the settings drawer, a true sibling panel that already shrinks the
  // container's own rect for free). Without this, the container's raw
  // rect.left sits *behind* that sticky column, so the threshold zone was
  // only reachable by dragging the pointer underneath it — visually
  // indistinguishable from "drag all the way to the far edge". No view has
  // an equivalent vertical overlay, so this only ever applies to the x axis.
  startInset = 0,
) {
  const rafRef = useRef<number | null>(null);
  const clientXRef = useRef(0);
  const clientYRef = useRef(0);
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
      let scrolled = false;

      if (axis === 'x' || axis === 'both') {
        const pos = clientXRef.current;
        const edgeStart = rect.left + startInset;
        const edgeEnd = rect.right;
        const distFromStart = pos - edgeStart;
        const distFromEnd = edgeEnd - pos;
        let delta = 0;
        if (distFromStart >= 0 && distFromStart < threshold) {
          delta = -speed * (1 - distFromStart / threshold);
        } else if (distFromEnd >= 0 && distFromEnd < threshold) {
          delta = speed * (1 - distFromEnd / threshold);
        }
        if (delta !== 0) {
          const maxScrollLeft = container.scrollWidth - container.clientWidth;
          const prev = container.scrollLeft;
          container.scrollLeft = Math.min(maxScrollLeft, Math.max(0, prev + delta));
          if (container.scrollLeft !== prev) scrolled = true;
        }
      }

      if (axis === 'y' || axis === 'both') {
        const pos = clientYRef.current;
        const edgeStart = rect.top;
        const edgeEnd = rect.bottom;
        const distFromStart = pos - edgeStart;
        const distFromEnd = edgeEnd - pos;
        let delta = 0;
        if (distFromStart >= 0 && distFromStart < threshold) {
          delta = -speed * (1 - distFromStart / threshold);
        } else if (distFromEnd >= 0 && distFromEnd < threshold) {
          delta = speed * (1 - distFromEnd / threshold);
        }
        if (delta !== 0) {
          const maxScrollTop = container.scrollHeight - container.clientHeight;
          const prev = container.scrollTop;
          container.scrollTop = Math.min(maxScrollTop, Math.max(0, prev + delta));
          if (container.scrollTop !== prev) scrolled = true;
        }
      }

      if (scrolled) onTickRef.current?.();
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

  const update = useCallback((clientX: number, clientY: number) => {
    clientXRef.current = clientX;
    clientYRef.current = clientY;
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
