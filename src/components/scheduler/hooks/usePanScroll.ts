import { useCallback, useEffect, useRef, type RefObject } from 'react';

const CLICK_MOVE_THRESHOLD_PX = 3;

// How far back (ms) the velocity estimate looks when the drag releases —
// just the last two pointermove events is too noisy: a brief pause right
// before lifting the finger/mouse reads as near-zero velocity even mid-fling,
// since that final delta alone is what's measured. Using the oldest sample
// still inside this window against the newest one smooths that out.
const VELOCITY_SAMPLE_WINDOW_MS = 100;
// Below this speed (px/ms) at release, no fling at all — just an ordinary
// drag that happened to end gently, not one asking for momentum.
const MIN_FLING_VELOCITY = 0.15;
// Below this speed (px/ms) the coast is imperceptible anyway — stop the
// animation loop rather than let it run forever asymptotically approaching 0.
const MIN_COAST_VELOCITY = 0.02;
// If the pointer hasn't actually moved in at least this long before release
// (drag somewhere, hold still, then let go), the most recent sample in the
// window is stale leftover speed from BEFORE the halt — without this check,
// releasing after a deliberate pause still launched a coast from however
// fast the drag was moving right before it stopped.
const STALE_HALT_MS = 100;
// Caps a noisy/very fast final pointer jump from producing an absurdly long
// coast.
const MAX_FLING_VELOCITY = 3.5;
// Per-frame (~16.67ms) decay factor — velocity keeps ~92% of itself every
// frame, so the coast feels like it's gliding to a stop rather than either
// snapping to zero or drifting on forever.
const FRICTION_PER_FRAME = 0.92;
const FRAME_MS = 1000 / 60;

export interface PanClickPoint {
  clientX: number;
  clientY: number;
  /** Position relative to the scroll container's content (i.e. includes scrollLeft/Top) — matches usePointerDrag's DragPoint shape, since a click never moves the container, so the start-of-gesture scroll position is still the current one. */
  contentX: number;
  contentY: number;
}

export interface UsePanScrollOptions {
  containerRef: RefObject<HTMLElement | null>;
  /** Which axes the drag scrolls — 'both' (default), or locked to just one. */
  axis?: 'both' | 'x' | 'y';
  /** Fired instead of a pan when the gesture never moves past the click threshold — lets a caller keep reporting a plain click even though dragging now scrolls rather than doing nothing. */
  onClick?: (point: PanClickPoint) => void;
}

/**
 * Grab-and-drag panning for a scrollable container's empty background — a
 * mouse-driven way to scroll wherever the pointer already is, rather than
 * having to reach for a scrollbar or a wheel/trackpad gesture. Releasing
 * mid-motion keeps coasting with momentum (see startCoast), same as a
 * trackpad/touch scroll would, rather than stopping dead the instant the
 * pointer lifts. Deliberately separate from usePointerDrag (which this
 * superficially resembles): that hook's edge auto-scroll is for keeping a
 * dragged *event* visible as it nears the container edge, and would
 * otherwise fight this hook's own direct scrollLeft/scrollTop writes on
 * every pointer move.
 */
export function usePanScroll({ containerRef, axis = 'both', onClick }: UsePanScrollOptions) {
  const startRef = useRef({ clientX: 0, clientY: 0, scrollLeft: 0, scrollTop: 0 });
  const movedRef = useRef(false);
  const onClickRef = useRef(onClick);
  useEffect(() => {
    onClickRef.current = onClick;
  });

  // Recent (time, scrollLeft, scrollTop) samples from this drag — trimmed to
  // the last VELOCITY_SAMPLE_WINDOW_MS on every move — used to estimate a
  // release velocity for the momentum coast below.
  const samplesRef = useRef<{ time: number; scrollLeft: number; scrollTop: number }[]>([]);
  const coastFrameRef = useRef<number | null>(null);

  const stopCoast = useCallback(() => {
    if (coastFrameRef.current != null) {
      cancelAnimationFrame(coastFrameRef.current);
      coastFrameRef.current = null;
    }
  }, []);

  const startCoast = useCallback(
    (vxStart: number, vyStart: number) => {
      if (typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
      let vx = vxStart;
      let vy = vyStart;
      let lastTime = performance.now();
      const tick = (now: number) => {
        const container = containerRef.current;
        if (!container) {
          coastFrameRef.current = null;
          return;
        }
        const dt = now - lastTime;
        lastTime = now;
        container.scrollLeft += vx * dt;
        container.scrollTop += vy * dt;
        const decay = Math.pow(FRICTION_PER_FRAME, dt / FRAME_MS);
        vx *= decay;
        vy *= decay;
        if (Math.hypot(vx, vy) < MIN_COAST_VELOCITY) {
          coastFrameRef.current = null;
          return;
        }
        coastFrameRef.current = requestAnimationFrame(tick);
      };
      coastFrameRef.current = requestAnimationFrame(tick);
    },
    [containerRef],
  );

  const handlePointerMove = useCallback(
    (e: PointerEvent) => {
      const container = containerRef.current;
      if (!container) return;
      const dx = e.clientX - startRef.current.clientX;
      const dy = e.clientY - startRef.current.clientY;
      if (!movedRef.current && Math.hypot(dx, dy) > CLICK_MOVE_THRESHOLD_PX) movedRef.current = true;
      if (axis !== 'y') container.scrollLeft = startRef.current.scrollLeft - dx;
      if (axis !== 'x') container.scrollTop = startRef.current.scrollTop - dy;

      const now = performance.now();
      const samples = samplesRef.current;
      samples.push({ time: now, scrollLeft: container.scrollLeft, scrollTop: container.scrollTop });
      while (samples.length > 1 && now - samples[0].time > VELOCITY_SAMPLE_WINDOW_MS) samples.shift();
    },
    [containerRef, axis],
  );

  const handlePointerUpRef = useRef<(e: PointerEvent) => void>(() => {});
  const handlePointerUp = useCallback(
    (e: PointerEvent) => {
      // Restores selectability regardless of whether this ended up being a
      // real pan or just a plain click — set unconditionally on pointerdown
      // below, so it's cleared unconditionally here too.
      document.body.style.userSelect = '';
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUpRef.current);
      if (!movedRef.current) {
        const rect = containerRef.current?.getBoundingClientRect();
        onClickRef.current?.({
          clientX: e.clientX,
          clientY: e.clientY,
          contentX: rect ? e.clientX - rect.left + startRef.current.scrollLeft : 0,
          contentY: rect ? e.clientY - rect.top + startRef.current.scrollTop : 0,
        });
        return;
      }
      const samples = samplesRef.current;
      const first = samples[0];
      const last = samples[samples.length - 1];
      if (!first || !last) return;
      // The pointer was held still since `last` — that stale sample no
      // longer reflects the halted state at actual release time.
      if (performance.now() - last.time > STALE_HALT_MS) return;
      const dt = last.time - first.time;
      if (dt <= 0) return;
      let vx = (last.scrollLeft - first.scrollLeft) / dt;
      let vy = (last.scrollTop - first.scrollTop) / dt;
      const speed = Math.hypot(vx, vy);
      if (speed < MIN_FLING_VELOCITY) return;
      if (speed > MAX_FLING_VELOCITY) {
        const scale = MAX_FLING_VELOCITY / speed;
        vx *= scale;
        vy *= scale;
      }
      startCoast(vx, vy);
    },
    [containerRef, handlePointerMove, startCoast],
  );

  useEffect(() => {
    handlePointerUpRef.current = handlePointerUp;
  });

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (e.button !== 0) return;
      const container = containerRef.current;
      if (!container) return;
      // Grabbing again mid-coast stops it dead, same as a real scrollable
      // surface — otherwise the new drag's own scrollLeft/scrollTop writes
      // would fight the still-running coast tick every frame.
      stopCoast();
      movedRef.current = false;
      startRef.current = {
        clientX: e.clientX,
        clientY: e.clientY,
        scrollLeft: container.scrollLeft,
        scrollTop: container.scrollTop,
      };
      samplesRef.current = [{ time: performance.now(), scrollLeft: container.scrollLeft, scrollTop: container.scrollTop }];
      // A fast drag over any nearby text (a room name, a day label) would
      // otherwise highlight it instead of just panning.
      document.body.style.userSelect = 'none';
      window.addEventListener('pointermove', handlePointerMove);
      window.addEventListener('pointerup', handlePointerUp);
    },
    [containerRef, stopCoast, handlePointerMove, handlePointerUp],
  );

  // Unmounting mid-drag (e.g. switching views while panning) would otherwise
  // leave <body> stuck with `user-select: none` forever, since pointerup
  // would fire with no listener left to hear it — and a still-running coast
  // would keep writing to a container that's about to be gone.
  useEffect(
    () => () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUpRef.current);
      document.body.style.userSelect = '';
      stopCoast();
    },
    [handlePointerMove, stopCoast],
  );

  return { onPointerDown };
}
